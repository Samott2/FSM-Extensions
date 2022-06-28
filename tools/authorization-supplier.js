  const authorizationSupplier = (() => {
  const AUTHORIZATION_SUPPLIER_UDO_META_NAME = 'Authorization_supplier';
  const COLUMNS = [
    { key: 'id', title: 'ID' },
    { key: 'z_f_co_dodavatel', title: 'Názov business partnera' }, // needs to be remapped: id <--> name
    { key: 'z_f_co_pass_master', title: 'Heslo master' },
    { key: 'z_f_co_pass_user', title: 'Heslo partner' },
  ];

  async function fetchAuthorizationSupplier() {
    const entries = [];

    let page = 1;
    while (true) {
      const response = await fetch(
        'https://eu.coresuite.com/api/query/v1?' + new URLSearchParams({
          ...await common.getSearchParams(),
          dtos: 'UdoValue.9;UdoMeta.9;BusinessPartner.23',
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
                bp.name AS z_f_co_dodavatel,
                uv.udf.z_f_co_pass_master AS z_f_co_pass_master,
                uv.udf.z_f_co_pass_user AS z_f_co_pass_user
              FROM UdoMeta um
              JOIN UdoValue uv
                ON um.id = uv.meta
              LEFT JOIN BusinessPartner bp
                ON uv.udf.z_f_co_dodavatel = bp.id
              WHERE um.name = '${AUTHORIZATION_SUPPLIER_UDO_META_NAME}'
            `,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch ${AUTHORIZATION_SUPPLIER_UDO_META_NAME}, got status ${response.status}`);
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

  async function importAuthorizationSupplier() {
    const inputElement = document.getElementById('input-authorization-supplier');
    const [file] = inputElement.files;

    const reader = new FileReader();
    reader.readAsArrayBuffer(file);
    await new Promise((rs) => reader.onload = rs);
    const arrayBuffer = reader.result;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(arrayBuffer);

    const businessPartnerMap = await common.fetchBusinessPartnerMap();

    const worksheet = workbook.getWorksheet('Authorization Supplier');

    const incomingAuthorizationSupplier = workbook.worksheets.reduce((incomingAuthorizationSupplier, worksheet) => {
      worksheet.eachRow((row, iRow) => {
        if (iRow === 1) return; // skip header

        const entry = COLUMNS.reduce((entry, col, iCol) => {
          const text = row.getCell(iCol + 1).text;
          let val = entry[col.key] = text && text.trim() || undefined;
          return entry;
        }, {});

        entry._iRow = iRow;
        entry._worksheet = worksheet.name;

        incomingAuthorizationSupplier.push(entry);
      });
      return incomingAuthorizationSupplier;
    }, []);

    const currentAuthorizationSupplier = await fetchAuthorizationSupplier();

    const currentAuthorizationSupplierMap = new Map(currentAuthorizationSupplier.map(e => [ e.id, e ]));
    const incomingAuthorizationSupplierMap = new Map(incomingAuthorizationSupplier.map(e => [ e.id, e ]));

    const entriesFailedToMap = [];
    const mapFields = e => {
      e.z_f_co_dodavatel = businessPartnerMap.get(e.z_f_co_dodavatel);

      const mappedSuccessfully = !!e.z_f_co_dodavatel;

      if (!mappedSuccessfully) {
        entriesFailedToMap.push(e);
      }

      return mappedSuccessfully;
    }

    const entriesToRemove = currentAuthorizationSupplier.filter(e => !incomingAuthorizationSupplierMap.has(e.id));
    const entriesToCreate = incomingAuthorizationSupplier
      .filter(e => {
        if (currentAuthorizationSupplierMap.has(e.id)) {
          return false;
        }

        return mapFields(e);
      });
    const entriesToUpdate = incomingAuthorizationSupplier
      .filter(incoming => {
        const current = currentAuthorizationSupplierMap.get(incoming.id);
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

    const udfMeta = await common.fetchUdfMeta(AUTHORIZATION_SUPPLIER_UDO_META_NAME);
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

      if (!responseForUpdate.ok) {
        throw new Error(`Failed to update ${AUTHORIZATION_SUPPLIER_UDO_META_NAME} entries, got status ${responseForUpdate.status}`);
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

      if (!responseForCreate.ok) {
        throw new Error(`Failed to create ${AUTHORIZATION_SUPPLIER_UDO_META_NAME} entries, got status ${responseForCreate.status}`);
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

      if (!responseForDelete.ok) {
        throw new Error(`Failed to remove ${AUTHORIZATION_SUPPLIER_UDO_META_NAME} entries, got status ${responseForDelete.status}`);
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

  async function exportAuthorizationSupplier() {
    const entries = await fetchAuthorizationSupplier();
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Authorization Supplier');
    
    const header = COLUMNS.map(e => e.title);
    worksheet.addRow(header);

    const rows = entries
      .forEach(entry => {
        worksheet.addRow(COLUMNS.map(({ key }) => entry[key]));
      });

    const link = document.createElement('a');
    link.style = "display: none";
    link.href = ui.createDownloadLink(await workbook.xlsx.writeBuffer()); // We have a fallback here.
    link.download = 'cennik.xlsx';

    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  return {
    importAuthorizationSupplier,
    exportAuthorizationSupplier,
  };
})();
