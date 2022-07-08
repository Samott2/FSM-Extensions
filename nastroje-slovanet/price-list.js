  const priceList = (() => {
  const PRICE_LIST_UDO_META_NAME = 'Cennik_part';
  const COLUMNS = [
    { key: 'id', title: 'ID' },
    { key: 'z_f_co_dodavatel', title: 'Dodávateľ' }, // needs to be remapped: id <--> name
    { key: 'z_f_co_type_sc', title: 'Typ servisného volania' }, // needs to be remapped: id <--> name
    { key: 'z_f_co_typtagu', title: 'Typ tagu' },
    { key: 'z_f_co_neuspesna_inst', title: 'Neuspešná inštalácia' },
    { key: 'z_f_co_podkatsiete', title: 'Podkategória siete' },
    { key: 'z_f_co_typbudovy', title: 'Typ budovy' },
    { key: 'z_f_co_city', title: 'Mesto' },
    { key: 'z_f_co_street', title: 'Ulica' },
    { key: 'z_f_co_snumber', title: 'Číslo domu' },
    { key: 'z_f_co_time_from', title: 'Čas od' },
    { key: 'z_f_co_time_to', title: 'Čas do' },
    { key: 'z_f_co_cena', title: 'Cena' },
  ];

  async function fetchServiceCallTypeMap() {
    const response = await fetch(
      'https://eu.coresuite.com/api/query/v1?' + new URLSearchParams({
        ...await common.getSearchParams(),
        dtos: 'ServiceCallType.15',
      }),
      {
        method: 'POST',
        headers: await common.getHeaders(),
        body: JSON.stringify({
          query: `
            SELECT
              sct.id AS id,
              sct.name AS name
            FROM ServiceCallType sct
          `,
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch BusinessPartners, got status ${response.status}`);
    }

    const arr = (await response.json()).data;
    return new Map(arr.map(e => [e.name, e.id]));
  }

  async function fetchPriceList() {
    const entries = [];

    let page = 1;
    while (true) {
      const response = await fetch(
        'https://eu.coresuite.com/api/query/v1?' + new URLSearchParams({
          ...await common.getSearchParams(),
          dtos: 'UdoValue.9;UdoMeta.9;BusinessPartner.23;ServiceCallType.15',
          pageSize: 1000,
          page: page,
        }),
        {
          method: 'POST',
          headers: await common.getHeaders(),
          body: JSON.stringify({
            query: `
              SELECT
                uv.id AS id,
                uv.udf.z_f_co_cena AS z_f_co_cena,
                bp.name AS z_f_co_dodavatel,
                sct.name AS z_f_co_type_sc,
                uv.udf.z_f_co_typtagu AS z_f_co_typtagu,
                uv.udf.z_f_co_typbudovy AS z_f_co_typbudovy,
                uv.udf.z_f_co_podkatsiete AS z_f_co_podkatsiete,
                uv.udf.z_f_co_city AS z_f_co_city,
                uv.udf.z_f_co_street AS z_f_co_street,
                uv.udf.z_f_co_snumber AS z_f_co_snumber,
                uv.udf.z_f_co_neuspesna_inst AS z_f_co_neuspesna_inst,
                uv.udf.z_f_co_time_from AS z_f_co_time_from,
                uv.udf.z_f_co_time_to AS z_f_co_time_to
              FROM UdoMeta um
              JOIN UdoValue uv
                ON um.id = uv.meta
              LEFT JOIN BusinessPartner bp
                ON uv.udf.z_f_co_dodavatel = bp.id
              LEFT JOIN ServiceCallType sct
                ON uv.udf.z_f_co_type_sc = sct.id
              WHERE um.name = '${PRICE_LIST_UDO_META_NAME}'
              AND uv.udf.z_f_co_km IS NULL
            `,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch price list, got status ${response.status}`);
      }

      const body = await response.json();

      Array.prototype.push.apply(entries, body.data);

      if (body.currentPage < body.lastPage) {
        page = body.currentPage + 1;
      } else {
        break;
      }
    };

    return entries;
  }

  async function importPriceList() {
    const inputElement = document.getElementById('input-price-list');
    const [file] = inputElement.files;

    const reader = new FileReader();
    reader.readAsArrayBuffer(file);
    await new Promise((rs) => reader.onload = rs);
    const arrayBuffer = reader.result;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(arrayBuffer);

    const businessPartnerMap = await common.fetchBusinessPartnerMap();
    const serviceCallTypeMap = await fetchServiceCallTypeMap();

    const worksheet = workbook.getWorksheet('Cenník');

    const incomingPriceList = workbook.worksheets.reduce((incomingPriceList, worksheet) => {
      worksheet.eachRow((row, iRow) => {
        if (iRow === 1) return; // skip header

        const entry = COLUMNS.reduce((entry, col, iCol) => {
          const text = row.getCell(iCol + 1).text;
          let val = entry[col.key] = text && text.trim() || undefined;
          return entry;
        }, {});

        entry._iRow = iRow;
        entry._worksheet = worksheet.name;

        incomingPriceList.push(entry);
      });
      return incomingPriceList;
    }, []);

    const currentPriceList = await fetchPriceList();

    const currentPriceMap = new Map(currentPriceList.map(e => [ e.id, e ]));
    const incomingPriceMap = new Map(incomingPriceList.map(e => [ e.id, e ]));

    const entriesFailedToMap = [];
    const mapFields = e => {
      e.z_f_co_dodavatel = businessPartnerMap.get(e.z_f_co_dodavatel);
      e.z_f_co_type_sc = serviceCallTypeMap.get(e.z_f_co_type_sc);

      const mappedSuccessfully = e.z_f_co_dodavatel && e.z_f_co_type_sc;
      if (!mappedSuccessfully) {
        entriesFailedToMap.push(e);
      }

      return mappedSuccessfully;
    }

    const entriesToRemove = currentPriceList.filter(e => !incomingPriceMap.has(e.id));
    const entriesToCreate = incomingPriceList
      .filter(e => {
        if (currentPriceMap.has(e.id)) {
          return false;
        }

        return mapFields(e);
      });
    const entriesToUpdate = incomingPriceList
      .filter(incoming => {
        const current = currentPriceMap.get(incoming.id);
        if (!current || COLUMNS.every(({ key }) => incoming[key] === current[key])) {
          return false;
        }

        return mapFields(incoming);
      });

    console.debug([
      `entriesToRemove: ${entriesToRemove.length}`,
      `entriesToCreate: ${entriesToCreate.length}`,
      `entriesToUpdate: ${entriesToUpdate.length}`,
      `entriesFailedToMap: ${entriesFailedToMap.length}`,
    ].join(', '));

    const udfMeta = await common.fetchUdfMeta(PRICE_LIST_UDO_META_NAME);
    const udfMetaByName = new Map(udfMeta.map(e => [e.name, e]));

    if (entriesToUpdate.length) {
      const responseForUpdate = await fetch(
        'https://eu.coresuite.com/api/data/v4/UdoValue/bulk?' + new URLSearchParams({
          ...await common.getSearchParams(),
          dtos: 'UdoValue.9',
          forceUpdate: true,
        }),
        {
          method: 'PATCH',
          headers: await common.getHeaders(),
          body: JSON.stringify(
            entriesToUpdate.map(entry => ({
              id: entry.id,
              udfValues: COLUMNS
                .map(({ key }) => {
                  const meta = udfMetaByName.get(key);
                  const value = entry[key];
                  return meta && value && {
                    meta: { id: meta.id },
                    value: value,
                  };
                })
                .filter(e => e),
            })),
          ),
        },
      );

      // TODO: this is bulk API and it always return 2xx
      if (!responseForUpdate.ok) {
        throw new Error(`Failed to update price list entries, got status ${responseForUpdate.status}`);
      }
    }

    if (entriesToCreate.length) {
      const responseForCreate = await fetch(
        'https://eu.coresuite.com/api/data/v4/UdoValue/bulk?' + new URLSearchParams({
          ...await common.getSearchParams(),
          dtos: 'UdoValue.9',
          forceUpdate: true,
        }),
        {
          method: 'PUT',
          headers: await common.getHeaders(),
          body: JSON.stringify(
            entriesToCreate.map(entry => ({
              meta: udfMeta[0].udoMetaId,
              udfValues: COLUMNS
                .map(({ key }) => {
                  const meta = udfMetaByName.get(key);
                  const value = entry[key];
                  return meta && value && {
                    meta: { id: meta.id },
                    value: value,
                  };
                })
                .filter(e => e),
            })),
          ),
        },
      );

      // TODO: this is bulk API and it always return 2xx
      if (!responseForCreate.ok) {
        throw new Error(`Failed to create price list entries, got status ${responseForCreate.status}`);
      }
    }

    if (entriesToRemove.length) {
      const responseForDelete = await fetch(
        'https://eu.coresuite.com/api/data/v4/UdoValue/bulk?' + new URLSearchParams({
          ...await common.getSearchParams(),
          forceDelete: true,
        }),
        {
          method: 'DELETE',
          headers: await common.getHeaders(),
          body: JSON.stringify(
            entriesToRemove.map(entry => ({
              id: entry.id,
            })),
          ),
        },
      );

      // TODO: this is bulk API and it always return 2xx
      if (!responseForDelete.ok) {
        throw new Error(`Failed to remove price list entries, got status ${responseForDelete.status}`);
      }
    }

    const entriesFailedToMapStr =
      '\n\nČísla chybných riadkov:\n' +
      Object.entries(
        entriesFailedToMap.reduce((acc, e) => {
          (acc[e._worksheet] || (acc[e._worksheet] = [])).push(e._iRow);
          return acc;
        }, {})
      )
        .map(([worksheetName, iRows]) => `${worksheetName}: ${iRows.join(', ')}`)
        .join('\n');

    ui.showResultDialog(
      'Import prebehol úspešne',
      'Počet záznamov ' + [
        `odstránených: ${entriesToRemove.length}`,
        `vytvorených: ${entriesToCreate.length}`,
        `upravených: ${entriesToUpdate.length}`,
        `chybných: ${entriesFailedToMap.length}`,
      ].join(', ') + '.' + (entriesFailedToMap.length ? entriesFailedToMapStr : ''),
    );
  }

  async function exportPriceList() {
    const entries = await fetchPriceList();

    const header = COLUMNS.map(e => e.title);
    const sheetsByPartner = entries
      .reduce((sheets, entry) => {
        const row = COLUMNS.map(({ key }) => entry[key]);
        (sheets[entry.z_f_co_dodavatel] || (sheets[entry.z_f_co_dodavatel] = [])).push(row);
        return sheets;
      }, {});

    const workbook = new ExcelJS.Workbook();

    Object.entries(sheetsByPartner).forEach(([partner, rows]) => {
      const worksheet = workbook.addWorksheet(partner);
      worksheet.addRow(header);
      worksheet.addRows(rows);
    });

    const link = document.createElement('a');
    link.style = 'display: none';
    link.href = ui.createDownloadLink(await workbook.xlsx.writeBuffer()); // We have a fallback here.
    link.download = 'cennik.xlsx';

    //document.body.appendChild(link);
    link.click();
    link.remove();
  }

  return {
    importPriceList,
    exportPriceList,
  };
})();
