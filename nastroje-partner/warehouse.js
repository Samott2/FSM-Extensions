  const warehouse = (() => {
  const state = {
    currentPage: 1,
    personId: null,
    filters: resetFilters(),
    warehouses: [{
      warehouseId: 'warehouseId',
      warehouseName: 'warehouseName',
      businessPartnerId: 'businessPartnerId',
      businessPartnerName: 'businessPartnerName',
    }],
    warehouseSearch: '',
  };

  const filtersMapping = {
    'Meno_polozky': (val) => val && `LOWER(i.name) LIKE '%${val.toLowerCase()}%'`,
    'Nazov': (val) => val && `LOWER(sn.udf.z_f_sn_nazov) LIKE '%${val.toLowerCase()}%'`,
    'HIM': (val) => val && `LOWER(sn.udf.z_f_sn_him) LIKE '%${val.toLowerCase()}%'`,
    'SerialNumber': (val) => val && `LOWER(sn.serialNumber) LIKE '%${val.toLowerCase()}%'`,
    // 'Datum_vytvorenia': // not implemented,
    'MAC_adresa': (val) => val && `LOWER(sn.udf.z_f_sn_macadresa) LIKE '%${val.toLowerCase()}%'`,
    'Nazov_skladu': (val) => val && `LOWER(w.name) = '${val.toLowerCase()}'`,
    'Partner': (val) => val && `LOWER(bp.name) LIKE '%${val.toLowerCase()}%'`,
    'Pokazene': (val) => {
      if (val && val !== 'TRUE' && val !== 'FALSE') {
        throw new Error('Expected "TRUE", "FALSE", or undefined.');
      }
      return val && `sn.inactive = ${val}`;
    },
  };

  /** @returns {Promise<{ currentPage: number, data: Record<string, any>[], lastPage: number, pageSize: number, totalObjectCount: number, truncated: boolean }>} */
  async function fetchWarehouse(personId, filters = {}, page = 1, pageSize = 100) {
    if (page < 1 || 1000 < pageSize) {
      throw new Error('Page has to be >=1 and pageSize <=1000.');
    }

    const filtersQuery = Object.entries(filters)
      .map(([colName, value]) => {
        const map = filtersMapping[colName];
        const q = map && map(value) || "";
        return q;
      })
      .filter(e => e)
      .join(" AND ");

    const response = await fetch(
      'https://eu.coresuite.com/api/query/v1?' + new URLSearchParams({
        ...await common.getSearchParams(),
        dtos: 'BusinessPartner.23;Person.24;SerialNumber.11;Item.23;Warehouse.16;UdfMeta.19',
        pageSize,
        page,
      }),
      {
        method: 'POST',
        headers: await common.getHeaders(),
        body: JSON.stringify({
          query: `
            SELECT
              sn.id AS serialNumberId,
              i.name AS Meno_polozky,
              sn.udf.z_f_sn_nazov AS Nazov,
              sn.udf.z_f_sn_him AS HIM,
              sn.serialNumber AS SerialNumber,
              sn.createDateTime AS Datum_vytvorenia,
              sn.udf.z_f_sn_macadresa AS MAC_adresa,
              w.name AS Nazov_skladu,
              bp.name AS Partner,
              sn.inactive AS Pokazene
            FROM SerialNumber sn
            JOIN Item i
              ON sn.item = i.id
            JOIN Warehouse w
              ON sn.warehouse = w.id
            JOIN Person p
              ON p.id IN w.owners
            JOIN BusinessPartner bp
              ON p.businessPartner = bp.id
            WHERE p.id = '${personId}'
            ${filtersQuery ? "AND  " + filtersQuery : ""}
            ORDER BY sn.createDateTime DESC
          `,
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch warehouse, got status ${response.status}`);
    }

    const body = await response.json();

    return body;
  }

  /**
   * @param {string} personId
   * @returns {Promise<{ warehouseId: string, warehouseName: string, businessPartnerId: string, businessPartnerName: string }[]>}
   */
  async function fetchWarehouses(personId) {
    const entries = [];

    let page = 1;
    while (true) {
      const response = await fetch(
        'https://eu.coresuite.com/api/query/v1?' + new URLSearchParams({
          ...await common.getSearchParams(),
          dtos: 'BusinessPartner.23;Person.24;Warehouse.16',
          pageSize: 1000,
          page: page,
        }),
        {
          method: 'POST',
          headers: await common.getHeaders(),
          body: JSON.stringify({
            query: `
            SELECT DISTINCT
              w.id AS warehouseId,
              w.name AS warehouseName,
              bp.id AS businessPartnerId,
              bp.name AS businessPartnerName
            FROM Warehouse w
            JOIN Person p
              ON p.id IN w.owners
            JOIN BusinessPartner bp
              ON p.businessPartner = bp.id
            WHERE p.id = '${personId}'
            `,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch warehouses, got status ${response.status}`);
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

  /**
   * @param {string} businessPartnerId
   * @returns {Promise<string>}
   */
  async function fetchPersonIdForBusinessPartner(businessPartnerId) {
    const response = await fetch(
      'https://eu.coresuite.com/api/query/v1?' + new URLSearchParams({
        ...await common.getSearchParams(),
        dtos: 'Person.24;BusinessPartner.23;SerialNumber.11;Warehouse.16',
      }),
      {
        method: 'POST',
        headers: await common.getHeaders(),
        body: JSON.stringify({
          query: `
            SELECT
              p.id as id
            FROM SerialNumber sn
            JOIN Warehouse w
              ON sn.warehouse = w.id
            JOIN Person p
              ON p.id IN w.owners
            JOIN BusinessPartner bp
              ON p.businessPartner = bp.id
            WHERE bp.id = '${businessPartnerId}'
            LIMIT 1
          `,
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch warehouse owner (Person), got status ${response.status}`);
    }

    const body = await response.json();
    const person = body.data[0];

    if (!person) {
      throw new Error(`No warehouse owner (Person) found for this ('${businessPartnerId}') business partner.`);
    }

    return person.id;
  }

  async function searchWarehouse(text) {
    state.warehouseSearch = text;
    await renderWarehouseList();
  }

  /** @param {{ warehouseId: string, warehouseName: string, businessPartnerId: string, businessPartnerName: string }[]} warehouses */
  async function renderWarehouseList() {
    const warehouseSearch = state.warehouseSearch.trim().toLowerCase();
    let warehouses = state.warehouses;

    if (warehouseSearch) {
      warehouses = warehouses.filter(warehouse =>
        warehouse.warehouseName.toLowerCase().includes(warehouseSearch) ||
        warehouse.businessPartnerName.toLowerCase().includes(warehouseSearch)
      );
    }

    const html = `
      <ul class="fd-list fd-list--byline fd-list--navigation" role="list" style="max-height: 500px; overflow: auto">
        ${warehouses.map(warehouse => `
          <li role="listitem" tabindex="-1" class="fd-list__item fd-list__item--link">
            <a tabindex="0" class="fd-list__link" href="javascript:void(0)" onclick="warehouse.selectWarehouse('${warehouse.warehouseId}', this.parentNode)">
              <div class="fd-list__content">
                <div class="fd-list__title" title="${warehouse.warehouseName}">${warehouse.warehouseName}</div>
                <div class="fd-list__byline" title="${warehouse.businessPartnerName}">${warehouse.businessPartnerName}</div>
              </div>
            </a>
          </li>
        `).join('\n')}
      </ul>
    `;
    
    const domParser = new DOMParser();
    const ul = domParser
      .parseFromString(html, 'text/html')
      .querySelector('ul');

    const container = document.getElementById('divWarehouses');
    container.innerHTML = '';
    container.append(ul);
  }

  async function renderTable() {
    const warehouse = await fetchWarehouse(state.personId, state.filters, state.currentPage, 100);

    const domParser = new DOMParser();

    const trs = warehouse.data.map((warehouseEntry, iRow) => {
      const trDocument = domParser.parseFromString(`
        <table>
          <tr class="fd-table__row" aria-selected="false" data-serialnumberid="${warehouseEntry.serialNumberId}">
            <td class="fd-table__cell fd-table__cell--checkbox">
              <input aria-label="checkbox" type="checkbox" class="fd-checkbox fd-checkbox--compact" id="tr${iRow}td1">
              <label class="fd-checkbox__label" for="tr${iRow}td1"></label>
            </td>
            <td class="fd-table__cell"></td>
            <td class="fd-table__cell"></td>
            <td class="fd-table__cell"></td>
            <td class="fd-table__cell"></td>
            <td class="fd-table__cell"></td>
            <td class="fd-table__cell"></td>
            <td class="fd-table__cell fd-table__cell--checkbox">
              <input aria-label="checkbox" type="checkbox" class="fd-checkbox fd-checkbox--compact" id="tr${iRow}td6" disabled checked>
              <label class="fd-checkbox__label" for="tr${iRow}td6"></label>
            </td>
          </tr>
        </table>
      `, 'text/html');

      const keys = [
        null,
        'Meno_polozky',
        'Nazov',
        'Datum_vytvorenia',
        'HIM',
        'SerialNumber',
        'MAC_adresa',
      ];

      const tds = trDocument.querySelectorAll('td');
      tds.forEach((td, i) => keys[i] && (td.innerText = warehouseEntry[keys[i]]));
      tds[tds.length - 1].querySelector('input').checked = warehouseEntry['Pokazene'].toLowerCase() === 'true';

      return trDocument.querySelector('tr');
    });

    const tbody = document.querySelector('#section-warehouse tbody');
    tbody.innerHTML = '';
    tbody.append(...trs);

    const pagination = document.querySelector('#section-warehouse .fd-pagination');
    if (warehouse.lastPage < 2) {
      pagination.classList.add('hidden');
    } else {
      pagination.classList.remove('hidden');
    }

    

    const inputPage = document.getElementById('input-page-w');
    state.currentPage = inputPage.value = warehouse.currentPage;
    inputPage.setAttribute('max', warehouse.lastPage);
    const totalLabel = document.getElementById('total-results-w');
    totalLabel.innerText = `${warehouse.lastPage} strán, ${warehouse.totalObjectCount} riadkov`;

    /**
     * 2022.07.11 Tamas Fordos
     * pagination arrows:
     */
     const paginationArrowLeft = document.getElementById('pagination-left-w');
     if (state.currentPage < 2) {
       paginationArrowLeft.classList.add('hidden');
     } else {
       paginationArrowLeft.classList.remove('hidden');
     }
 
     const paginationArrowRight = document.getElementById('pagination-right-w');
     if (inputPage.value == warehouse.lastPage) {
      paginationArrowRight.classList.add('hidden');
     } else {
      paginationArrowRight.classList.remove('hidden');
     }
  }

  async function onNavigate() {
    const context = await common.getContext();
    const person = await common.fetchPerson(context.erpUserId);
    const canAccessUdoMeta = await common.canAccessUdoMeta();

    if (person.crowdType !== 'PARTNER_ADMIN' && !canAccessUdoMeta) {
      return ui.showAccessRejectedDialog();
    }

    state.personId = context.erpUserId;
    state.warehouses = await fetchWarehouses(state.personId);

    await renderWarehouseList();
  }

  /**
   * @param {string} warehouseId
   * @param {Element} listItem
   */
  async function selectWarehouse(warehouseId, listItem) {
    const warehouse = state.warehouses.find(w => w.warehouseId === warehouseId);

    document.getElementById('lblSelectedWarehouse').innerText = warehouse.warehouseName;

    const selected = document.getElementById('divWarehouses').querySelector('li.is-selected');
    selected && selected.classList.toggle('is-selected');
    listItem.classList.toggle('is-selected');
    ui.toggleAttribute('aria-hidden', '#popoverWarehouseList .fd-popover__body');

    state.warehouseSearch = '';
    state.personId = await fetchPersonIdForBusinessPartner(warehouse.businessPartnerId);
    state.currentPage = 1;
    state.filters = resetFilters();
    await renderTable();
  }

  async function goToPage(page) {
    page = parseInt(page, 10);
    if (!page || page < 1) {
      return;
    }

    state.currentPage = page;

    await renderTable();
  }

  /**
   * 2022.07.11 Tamas Fordos
   * function for pagination arrows
   * @param {string} direction 
   */
  async function goToPageArrow(direction) {
    var pageNumber = 0;
    if (direction === 'left') {
      pageNumber = parseInt(document.getElementById('input-page-w').value, 10) - 1;
    } else if (direction === 'right') {
      pageNumber = parseInt(document.getElementById('input-page-w').value, 10) + 1;
    }
    await goToPage(pageNumber);
  }

  /**
   * @param {string} colName
   * @param {string} value
   * @param {Element} popover
   */
  async function filter(colName, value, popover) {
    if (!(colName in state.filters)) {
      throw new Error(`Cannot filter by column ${colName}, no such column.`)
    }

    state.filters[colName] = value;

    ui.toggleAttribute('aria-hidden', popover);

    await renderTable();
  }

  function resetFilters() {
    const filters = {
      'Meno_polozky': undefined,
      'Nazov': undefined,
      'HIM': undefined,
      'SerialNumber': undefined,
      // 'Datum_vytvorenia': undefined, // not implemented
      'MAC_adresa': undefined,
      'Nazov_skladu': undefined,
      'Partner': undefined,
      'Pokazene': undefined,
    };

    document.querySelectorAll('#section-warehouse .input-filter').forEach(e => e.value = '');

    return filters;
  }

  /** @param {boolean} [value] */
  function toggleSelectAll(value) {
    const trs = document.querySelectorAll('#section-warehouse table tbody tr');
    const checkboxes = Array.from(trs).map(tr => tr.querySelector('td:nth-child(1) input[type="checkbox"]'));
    const allChecked = Array.from(checkboxes).every(e => e.checked === true);
    if (allChecked && value !== true || value === false) {
      checkboxes.forEach((c, i) => {
        trs[i].setAttribute('aria-selected', 'false');
        c.checked = false;
      });
    } else {
      checkboxes.forEach((c, i) => {
        trs[i].setAttribute('aria-selected', 'true');
        c.checked = true;
      });
    }
  }

  /** @param {boolean} value */
  async function setDefunct(value) {
    const trs = Array
      .from(document.querySelectorAll('#section-warehouse table tbody tr td:nth-child(1) input[type="checkbox"]:checked'))
      .map(e => e.closest('tr'));

    const updates = trs.map(e => ({
      id: e.dataset.serialnumberid,
      inactive: value,
    }));

    toggleSelectAll(false);

    if (!updates.length) return;

    const responseForUpdate = await fetch(
      'https://eu.coresuite.com/api/data/v4/SerialNumber/bulk?' + new URLSearchParams({
        ...await common.getSearchParams(),
        dtos: 'SerialNumber.11',
        forceUpdate: true,
      }),
      {
        method: 'PATCH',
        headers: await common.getHeaders(),
        body: JSON.stringify(updates),
      },
    );

    if (!responseForUpdate.ok) {
      throw new Error(`Failed to update SerialNumber(s), got status ${responseForUpdate.status}`);
    }

    await renderTable();
  }

  return {
    selectWarehouse,
    searchWarehouse,
    onNavigate,
    goToPage,
    goToPageArrow,
    filter,
    toggleSelectAll,
    setDefunct,
  };
})();
