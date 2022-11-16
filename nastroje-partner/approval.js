const approval = (() => {
  const APPROVAL_UDO_META_NAME = 'Schvalovanie';
  const APPROVAL_STATUS = {
    Accepted: 'Zmena akceptovaná',
    Dismissed: 'Zmena zamietnutá',
    ChangeRequired: 'Požadovaná zmena',
    Approved: 'Schválené',
  };
  const state = {
    currentPage: 1,
    /** @type {{ id: string, crowdType: string, firstName: string, lastName: string }} */
    person: null,
    filters: resetFilters(),
    businessPartnerSearch: '',
    periodSearch: '',
    /** @type {{ id: string, name: string }[]} */
    businessPartners: null,
    /** @type {{ udoId: string, businessPartnerId: string, monthYear: string, approved: 'true'|'false', approvedByName: string, approvalDate: string }[]} */
    periods: [],
    /** @type {string} */
    selectedBusinessPartnerId: null,
    /** @type {string} MM/YYYY */
    selectedPeriodUdoId: null,
  };

  const filtersMapping = {
    'activityCode': (val) => val && `LOWER(a.code) LIKE '%${val.toLowerCase()}%'`,
    'serviceCallTypeName': (val) => val && `LOWER(sc.typeName) LIKE '%${val.toLowerCase()}%'`,
    'serviceCallCostStatus': (val) => val && `LOWER(sc.udf.z_f_sc_request_status) LIKE '%${val.toLowerCase()}%'`,
    'customer': (val) => val && `LOWER(bp.name) LIKE '%${val.toLowerCase()}%'`,
    'serviceCallCost': (val) => val && `LOWER(sc.udf.z_f_sc_request_cena) LIKE '%${val.toLowerCase()}%'`,
    'serviceCallComment': (val) => val && `LOWER(sc.udf.z_f_sc_request_poznamka) LIKE '%${val.toLowerCase()}%'`,
  };

  /**
   * @param {string} businessPartnerId
   * @returns {Promise<{ udoId: string, businessPartnerId: string, monthYear: string, approved: 'true'|'false', approvedByName: string, approvalDate: string }>}
   */
  async function fetchPeriods(businessPartnerId) {
    const response = await fetch(
      'https://eu.coresuite.com/api/query/v1?' + new URLSearchParams({
        ...await common.getSearchParams(),
        dtos: 'UdoValue.9',
        pageSize: 1000,
        page: 1,
      }),
      {
        method: 'POST',
        headers: await common.getHeaders(),
        body: JSON.stringify({
          query: `
            SELECT
              uv.id AS udoId,
              uv.udf.z_f_sfr_partner AS businessPartnerId,
              uv.udf.z_f_sfr_zucobd AS monthYear,
              uv.udf.z_f_sfr_schvalenie AS approved,
              uv.udf.z_f_sfr_schvalovatel AS approvedByName,
              uv.udf.z_f_sfr_datumschvalenia AS approvalDate
            FROM UdoValue uv
            WHERE uv.udf.z_f_sfr_partner = '${businessPartnerId}'
            ORDER BY uv.createDateTime DESC
          `,
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch approval status, got status ${response.status}`);
    }

    const body = await response.json();

    return body.data;
  }

  /** @returns {Promise<{ currentPage: number, data: Record<string, any>[], lastPage: number, pageSize: number, totalObjectCount: number, truncated: boolean }>} */
  async function fetchTable(businessPartnerId, monthYear, filters = {}, page = 1, pageSize = 100) {
    if (page < 1 || 1000 < pageSize) {
      throw new Error('Page has to be >=1 and pageSize <=1000.');
    }

    const since = moment(monthYear, 'MM/YYYY').startOf('month').toISOString().replace(/\.000Z$/, 'Z');
    const until = moment(monthYear, 'MM/YYYY').add(1, 'month').startOf('month').toISOString().replace(/\.000Z$/, 'Z');

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
        dtos: 'Activity.40;BusinessPartner.23;Mileage.17;Person.24;ServiceAssignment.28;ServiceCall.26;TimeEffort.16;UdoValue.9',
        pageSize,
        page,
      }),
      {
        method: 'POST',
        headers: await common.getHeaders(),
        body: JSON.stringify({
          query: `
            SELECT
              a.id AS activityId,
              a.code AS activityCode,
              sc.id AS serviceCallId,
              sc.typeCode AS serviceCallTypeCode,
              sc.typeName AS serviceCallTypeName,
              bp.name AS customer,
              mileage.distance AS mileageDistance,
              priceListUdo.udf.z_f_co_km AS mileageKmCost,
              priceListUdo.udf.z_f_co_km * mileage.distance AS mileageCost,
              effort.id AS timeEffortId,
              effort.udf.z_f_te_cena_final AS effortCost,
              DATEDIFF(MINUTE, effort.startDateTime, effort.endDateTime) AS effortDuration,
              COALESCE(priceListUdo.udf.z_f_co_km, 0) * COALESCE(mileage.distance, 0) + COALESCE(effort.udf.z_f_te_cena_final, 0) AS totalCost,
              sc.udf.z_f_sc_request_status AS serviceCallCostStatus,
              sc.udf.z_f_sc_request_poznamka AS serviceCallComment,
              sc.udf.z_f_sc_request_datum_vyjadrenia AS serviceCallCommentDate,
              sc.udf.z_f_sc_request_cena AS serviceCallCost,
              effort.startDateTime AS date,
              sc.businessPartner AS businessPartnerId
            FROM Activity a
            JOIN ServiceCall sc
              ON sc = a.object
            JOIN ServiceAssignment sa
              ON sc = sa.object
            JOIN Person p
              ON sa.technician = p.id
            JOIN BusinessPartner bp
              ON sc.businessPartner = bp.id
            LEFT JOIN Mileage mileage
              ON a = mileage.object
            LEFT JOIN TimeEffort effort
              ON a = effort.object
            JOIN UdoValue priceListUdo
              ON priceListUdo.udf.z_f_co_dodavatel = p.businessPartner
              AND priceListUdo.udf.z_f_co_km IS NOT NULL
            WHERE p.businessPartner = '${businessPartnerId}'
            AND (effort.startDateTime > '${since}' AND effort.startDateTime < '${until}')
            AND (mileage IS NOT NULL AND effort IS NOT NULL)
            ${filtersQuery ? "AND  " + filtersQuery : ""}
            ORDER BY effort.startDateTime DESC
          `,
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch table, got status ${response.status}`);
    }

    const body = await response.json();

    body.data.forEach(e => {
      e.date = moment(e.date).format('D.M.YYYY');
      e.effortDuration = minutesToHHMM(e.effortDuration);
    })

    return body;
  }

  /** @returns {Promise<number>} */
  async function countDisputed(businessPartnerId, monthYear) {
    const since = moment(monthYear, 'MM/YYYY').startOf('month').toISOString().replace(/\.000Z$/, 'Z');
    const until = moment(monthYear, 'MM/YYYY').add(1, 'month').startOf('month').toISOString().replace(/\.000Z$/, 'Z');

    const response = await fetch(
      'https://eu.coresuite.com/api/query/v1?' + new URLSearchParams({
        ...await common.getSearchParams(),
        dtos: 'Activity.40;BusinessPartner.23;Mileage.17;Person.24;ServiceAssignment.28;ServiceCall.26;TimeEffort.16;UdoValue.9',
        pageSize: 1,
        page: 1,
      }),
      {
        method: 'POST',
        headers: await common.getHeaders(),
        body: JSON.stringify({
          query: `
            SELECT
              COUNT(sc) AS countMatching
            FROM Activity a
            JOIN ServiceCall sc
              ON sc = a.object
            JOIN ServiceAssignment sa
              ON sc = sa.object
            JOIN Person p
              ON sa.technician = p.id
            JOIN BusinessPartner bp
              ON sc.businessPartner = bp.id
            LEFT JOIN Mileage mileage
              ON a = mileage.object
            LEFT JOIN TimeEffort effort
              ON a = effort.object
            JOIN UdoValue priceListUdo
              ON priceListUdo.udf.z_f_co_dodavatel = p.businessPartner
              AND priceListUdo.udf.z_f_co_km IS NOT NULL
            WHERE p.businessPartner = '${businessPartnerId}'
            AND (effort.startDateTime > '${since}' AND effort.startDateTime < '${until}')
            AND (mileage IS NOT NULL AND effort IS NOT NULL)
            AND sc.udf.z_f_sc_request_status = '${APPROVAL_STATUS.ChangeRequired}'
          `,
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Failed to count disputed entries, got status ${response.status}`);
    }

    const body = await response.json();

    return body.data[0].countMatching;
  }

  async function searchPeriod(text) {
    state.periodSearch = text;
    await renderPeriodList();
  }

  async function renderPeriodList() {
    const periodSearch = state.periodSearch.trim().toLowerCase();
    let periods = state.periods;

    if (periodSearch) {
      periods = periods.filter(month => month.monthYear.toLowerCase().includes(periodSearch));
    }

    const html = `
      <ul class="fd-list fd-list fd-list--navigation" role="list" style="max-height: 300px; overflow: auto">
        ${periods.map(period => `
          <li role="listitem" tabindex="-1" class="fd-list__item fd-list__item--link">
            <a tabindex="0" class="fd-list__link" href="javascript:void(0)" onclick="approval.selectPeriod('${period.udoId}', this.parentNode)">
              <div class="fd-list__content">
                <div class="fd-list__title" title="${period.monthYear}">${period.monthYear}</div>
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

    const lblSelectedPeriod = document.getElementById('lblSelectedPeriod');
    lblSelectedPeriod.innerText = lblSelectedPeriod.title;

    const container = document.getElementById('divPeriods');
    container.innerHTML = '';
    container.append(ul);
  }

  async function renderBusinessPartnerList() {
    const businessPartnerSearch = state.businessPartnerSearch.trim().toLowerCase();
    let businessPartners = state.businessPartners;

    if (businessPartnerSearch) {
      businessPartners = businessPartners.filter(businessPartner => businessPartner.name.toLowerCase().includes(businessPartnerSearch));
    }

    const html = `
      <ul class="fd-list fd-list fd-list--navigation" role="list" style="max-height: 300px; overflow: auto">
        ${businessPartners.map(businessPartner => `
          <li role="listitem" tabindex="-1" class="fd-list__item fd-list__item--link">
            <a tabindex="0" class="fd-list__link" href="javascript:void(0)" onclick="approval.selectBusinessPartner('${businessPartner.id}', this.parentNode)">
              <div class="fd-list__content">
                <div class="fd-list__title" title="${businessPartner.name}">${businessPartner.name}</div>
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

    const container = document.getElementById('divBusinessPartners');
    container.innerHTML = '';
    container.append(ul);
  }

  async function searchBusinessPartner(text) {
    state.businessPartnerSearch = text;
    await renderBusinessPartnerList();
  }

  /**
   * @param {string} businessPartnerId
   * @param {Element} listItem
   */
  async function selectBusinessPartner(businessPartnerId, listItem) {
    const businessPartner = state.businessPartners.find(bp => bp.id === businessPartnerId);

    document.getElementById('lblSelectedBusinessPartner').innerText = businessPartner.name;

    const selected = document.getElementById('divBusinessPartners').querySelector('li.is-selected');
    selected && selected.classList.toggle('is-selected');
    listItem.classList.toggle('is-selected');
    ui.toggleAttribute('aria-hidden', '#popoverBusinessPartnerList .fd-popover__body');

    state.businessPartnerSearch = '';
    state.selectedBusinessPartnerId = businessPartnerId;
    state.selectedPeriodUdoId = null;
    state.currentPage = 1;
    state.filters = resetFilters();
    state.periods = await fetchPeriods(businessPartnerId);

    await renderPeriodList();
    await renderBusinessPartnerList();
    await renderTable();
  }

  async function renderTable() {
	// 16. 11. 2022, T. Fordos
	// Suma na schvalenie: sum(table.data[n].totalCost)  
	let allCostToApproval = 0;
	
    const approvalStatus = state.selectedPeriodUdoId
      ? state.periods.find(period => period.udoId === state.selectedPeriodUdoId)
      : undefined;

    if (approvalStatus?.approved === 'true') {
      document.getElementById('btnApprove').classList.add('is-disabled');
      document.getElementById('btnDispute').classList.add('is-disabled');
      document.getElementById('btnAccept').classList.add('is-disabled');
      document.getElementById('btnDismiss').classList.add('is-disabled');
    } else if (approvalStatus) {
      document.getElementById('btnApprove').classList.remove('is-disabled');
      document.getElementById('btnDispute').classList.remove('is-disabled');
      document.getElementById('btnAccept').classList.remove('is-disabled');
      document.getElementById('btnDismiss').classList.remove('is-disabled');
    }

    document.getElementById('approvalApproved').innerText =
      approvalStatus?.approved === 'true' ? 'Áno' :
      approvalStatus ? 'Nie' :
      '';
    document.getElementById('approvalApprovedBy').innerText = approvalStatus?.approvedByName !== 'null' && approvalStatus?.approvedByName || '';
    document.getElementById('approvalDate').innerText = approvalStatus?.approvalDate !== 'null' && approvalStatus?.approvalDate || '';

    const isSelected = state.selectedPeriodUdoId && state.selectedBusinessPartnerId;
    if (!isSelected) {
      document.getElementById('btnApprove').classList.add('is-disabled');
      document.getElementById('btnDispute').classList.add('is-disabled');
      document.getElementById('btnAccept').classList.add('is-disabled');
      document.getElementById('btnDismiss').classList.add('is-disabled');
      state.currentPage = 1;
    }

    const period = isSelected
      ? state.periods.find(period => period.udoId === state.selectedPeriodUdoId)
      : undefined;
    const table = isSelected
      ? await fetchTable(state.selectedBusinessPartnerId, period.monthYear, state.filters, state.currentPage, 100)
      : {
        data: [],
        currentPage: 1,
        lastPage: 1,
        totalObjectCount: 0,
      };

    const domParser = new DOMParser();
	
	// 16. 11. 2022, T. Fordos - start
	// Suma na schvalenie: sum(table.data[i].totalCost) allCostToApproval €
	if (table.data.length) {
		for (let i = 0; i < table.data.length; i++) {
			allCostToApproval += table.data[i].totalCost;
		}
	}

	document.getElementById('approvalMoney').innerText = allCostToApproval > 0 ? `${allCostToApproval.toFixed(2)} €` : '';
	// 16. 11. 2022, T. Fordos - end
		

    const trs = table.data.map((tableEntry, iRow) => {
      const trDocument = domParser.parseFromString(`
        <table>
          <tr
            class="fd-table__row"
            aria-selected="false"
            data-servicecallid="${tableEntry.serviceCallId}"
            data-timeeffortid="${tableEntry.timeEffortId}"
            data-servicecallcost="${tableEntry.serviceCallCost}"
          >
            <td class="fd-table__cell fd-table__cell--checkbox">
              <input
                aria-label="checkbox"
                type="checkbox"
                class="fd-checkbox fd-checkbox--compact"
                id="tr${iRow}td1"
                onchange="ui.toggleAttribute('aria-selected', this.parentElement.parentElement)"
              >
              <label class="fd-checkbox__label" for="tr${iRow}td1"></label>
            </td>
            <td class="fd-table__cell"></td>
            <td class="fd-table__cell"></td>
            <td class="fd-table__cell"></td>
            <td class="fd-table__cell"></td>
            <td class="fd-table__cell"></td>
            <td class="fd-table__cell"></td>
            <td class="fd-table__cell"></td>
            <td class="fd-table__cell"></td>
            <td class="fd-table__cell"></td>
            <td class="fd-table__cell"></td>
            <td class="fd-table__cell"></td>
            <td class="fd-table__cell"></td>
          </tr>
        </table>
      `, 'text/html');

      const keys = [
        null,
        'date',
        'activityCode',
        'serviceCallTypeName',
        'customer',
        'serviceCallCostStatus',
        'effortDuration',
        'effortCost',
        'mileageDistance',
        'mileageCost',
        'totalCost',
        'serviceCallCost',
        'serviceCallComment',
      ];

      const tds = trDocument.querySelectorAll('td');
      tds.forEach((td, i) => {
        const key = keys[i]
        const value = key && tableEntry[key];
        if (value != null && value !== 'null') {
          td.innerText = value;
        }
      });

      const tr = trDocument.querySelector('tr');

      const trClass = 
        tableEntry.serviceCallCostStatus === APPROVAL_STATUS.ChangeRequired ? 'change-required' :
        tableEntry.serviceCallCostStatus === APPROVAL_STATUS.Accepted ? 'accepted' :
        tableEntry.serviceCallCostStatus === APPROVAL_STATUS.Dismissed ? 'dismissed' :
        undefined;
      if (trClass) {
        tr.classList.add(trClass);
      }

      return tr;
    });

    const tbody = document.querySelector('#section-approval tbody.approval');
    tbody.innerHTML = '';
    tbody.append(...trs);

    const pagination = document.querySelector('#section-approval .fd-pagination');
    if (table.lastPage < 2) {
      pagination.classList.add('hidden');
    } else {
      pagination.classList.remove('hidden');
    }

    const inputPage = document.getElementById('input-page');
    state.currentPage = inputPage.value = table.currentPage;
    inputPage.setAttribute('max', table.lastPage);
    document.getElementById('total-results').innerText = `${table.lastPage} strán, ${table.totalObjectCount} riadkov`;

    /**
     * 2022.07.11 Tamas Fordos
     * pagination arrows:
     */
     const paginationArrowLeft = document.getElementById('pagination-left-a');
     if (state.currentPage < 2) {
       paginationArrowLeft.classList.add('hidden');
     } else {
       paginationArrowLeft.classList.remove('hidden');
     }
 
     const paginationArrowRight = document.getElementById('pagination-right-a');
     if (inputPage.value == table.lastPage) {
      paginationArrowRight.classList.add('hidden');
     } else {
      paginationArrowRight.classList.remove('hidden');
     }
  }

  async function onNavigate() {
    const context = await common.getContext();
    state.person = await common.fetchPerson(context.erpUserId);

    state.businessPartners = await common.fetchBusinessPartners(
      'CROWD_PARTNER',
      state.person.crowdType === 'null' ? undefined : state.person.id
    );

    if (state.person.crowdType === "null") {
      document.querySelectorAll('.hide-admin').forEach(e => e.style.display = "none");
    } else {
      document.querySelectorAll('.hide-partner').forEach(e => e.style.display = "none");
    }

    await renderBusinessPartnerList();
    await renderPeriodList();
    await renderTable();
  }

  /**
   * @param {string} periodUdoId
   * @param {Element} listItem
   */
  async function selectPeriod(periodUdoId, listItem) {
    const period = state.periods.find(period => period.udoId === periodUdoId);

    document.getElementById('lblSelectedPeriod').innerText = period.monthYear;

    const selected = document.getElementById('divPeriods').querySelector('li.is-selected');
    selected && selected.classList.toggle('is-selected');
    listItem.classList.toggle('is-selected');
    ui.toggleAttribute('aria-hidden', '#popoverPeriodList .fd-popover__body');

    state.periodSearch = '';
    state.selectedPeriodUdoId = period.udoId;
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
      pageNumber = parseInt(document.getElementById('input-page').value, 10) - 1;
    } else if (direction === 'right') {
      pageNumber = parseInt(document.getElementById('input-page').value, 10) + 1;
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
      'activityCode': undefined,
      'serviceCallTypeName': undefined,
      'serviceCallCostStatus': undefined,
      'customer': undefined,
      'serviceCallCost': undefined,
      'serviceCallComment': undefined,
    };

    document.querySelectorAll('#section-approval .input-filter').forEach(e => e.value = '');

    return filters;
  }

  /** @param {boolean} [value] */
  function toggleSelectAll(value) {
    const trs = document.querySelectorAll('#section-approval table tbody.approval tr');
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

  async function approvePeriod() {
    if (!state.selectedPeriodUdoId) {
      return;
    }

    const period = state.periods.find(period => period.udoId === state.selectedPeriodUdoId);
    const disputedCount = await countDisputed(state.selectedBusinessPartnerId, period.monthYear);
    if (disputedCount) {
      return void ui.showResultDialog('Chyba', 'Report nie je možné schváliť, pretože obsahuje záznamy s vyžiadanou zmenou.')
    }


    const udfMeta = await common.fetchUdfMeta(APPROVAL_UDO_META_NAME);
    const udfMetaByName = new Map(udfMeta.map(e => [e.name, e]));
    const { firstName, lastName } = state.person;

    const updates = [{
      id: state.selectedPeriodUdoId,
      udfValues: [
        {
          meta: { id: udfMetaByName.get('z_f_sfr_schvalenie').id },
          value: 'true',
        },
        {
          meta: { id: udfMetaByName.get('z_f_sfr_datumschvalenia').id },
          value: moment().format('D.M.YYYY'),
        },
        {
          meta: { id: udfMetaByName.get('z_f_sfr_schvalovatel').id },
          value: `${firstName} ${lastName}`,
        },
      ],
    }];

    const responseForUpdate = await fetch(
      'https://eu.coresuite.com/api/data/v4/UdoValue/bulk?' + new URLSearchParams({
        ...await common.getSearchParams(),
        dtos: 'UdoValue.9',
        forceUpdate: true,
      }),
      {
        method: 'PATCH',
        headers: await common.getHeaders(),
        body: JSON.stringify(updates),
      },
    );

    if (!responseForUpdate.ok) {
      throw new Error(`Failed to update approval, got status ${responseForUpdate.status}`);
    }

    state.periods = await fetchPeriods(state.selectedBusinessPartnerId);
    await renderPeriodList();
    await renderTable();
  }

  /**
   * @param {string} status
   * @param {boolean} updateCost
   */
  async function updateStatusForSelected(status, updateCost) {
    const disputeCostEl = document.getElementById('disputeCostAdmin');
    const disputeCost = disputeCostEl.value
      ? parseFloat(disputeCostEl.value)
      : NaN;
    const trs = Array
      .from(document.querySelectorAll('#section-approval table tbody.approval tr td:nth-child(1) input[type="checkbox"]:checked'))
      .map(e => e.closest('tr'));

    if (!trs.length) {
      return;
    }

    const udfMeta = await common.fetchUdfMetaByFieldName([
      'z_f_sc_request_status',
      'z_f_sc_request_datum_vyjadrenia',
      'z_f_sc_request_cena',
      'z_f_te_cena_final',
    ]);
    const udfMetaByName = new Map(udfMeta.map(e => [e.name, e]));

    const now = new Date().toISOString();
    const scUpdates = trs.map(e => ({
      id: e.dataset.servicecallid,
      udfValues: [
        {
          meta: { id: udfMetaByName.get('z_f_sc_request_status').id },
          value: status,
        },
        {
          meta: { id: udfMetaByName.get('z_f_sc_request_datum_vyjadrenia').id },
          value: now,
        },
        updateCost && !isNaN(disputeCost) && {
          meta: { id: udfMetaByName.get('z_f_sc_request_cena').id },
          value: disputeCost,
        },
      ].filter(e => e),
    }));

    const responseForScUpdate = await fetch(
      'https://eu.coresuite.com/api/data/v4/ServiceCall/bulk?' + new URLSearchParams({
        ...await common.getSearchParams(),
        dtos: 'ServiceCall.26',
        forceUpdate: true,
      }),
      {
        method: 'PATCH',
        headers: await common.getHeaders(),
        body: JSON.stringify(scUpdates),
      },
    );

    if (!responseForScUpdate.ok) {
      throw new Error(`Failed to update ServiceCall, got status ${responseForScUpdate.status}`);
    }

    if (updateCost) {
      const teUpdates = trs.map(e => ({
        id: e.dataset.timeeffortid,
        udfValues: [
          {
            meta: { id: udfMetaByName.get('z_f_te_cena_final').id },
            value: isNaN(disputeCost)
              ? parseFloat(e.dataset.servicecallcost)
              : disputeCost,
          },
        ],
      }));

      const responseForTeUpdate = await fetch(
        'https://eu.coresuite.com/api/data/v4/TimeEffort/bulk?' + new URLSearchParams({
          ...await common.getSearchParams(),
          dtos: 'TimeEffort.16',
          forceUpdate: true,
        }),
        {
          method: 'PATCH',
          headers: await common.getHeaders(),
          body: JSON.stringify(teUpdates),
        },
      );
  
      if (!responseForTeUpdate.ok) {
        throw new Error(`Failed to update TimeEffort, got status ${responseForTeUpdate.status}`);
      }
    }

    await renderTable();
  }

  function acceptSelected() {
    return updateStatusForSelected(APPROVAL_STATUS.Accepted, true);
  }

  function dismissSelected() {
    return updateStatusForSelected(APPROVAL_STATUS.Dismissed, false);
  }

  async function disputeSelected() {
    const disputeCostEl = document.getElementById('disputeCostPartner');
    const disputeCommentEl = document.getElementById('disputeComment');

    const disputeCost = parseFloat(disputeCostEl.value);
    const disputeComment = disputeCommentEl.value.trim();

    if (!disputeCost || !disputeComment) {
      return;
    }

    const trs = Array
      .from(document.querySelectorAll('#section-approval table tbody.approval tr td:nth-child(1) input[type="checkbox"]:checked'))
      .map(e => e.closest('tr'));

    if (!trs.length) {
      return;
    }

    const udfMeta = await common.fetchUdfMetaByFieldName([
      'z_f_sc_request_status',
      'z_f_sc_request_poznamka',
      'z_f_sc_request_datum',
      'z_f_sc_request_cena',
    ]);
    const udfMetaByName = new Map(udfMeta.map(e => [e.name, e]));

    const now = new Date().toISOString();
    const updates = trs.map(e => ({
      id: e.dataset.servicecallid,
      udfValues: [
        {
          meta: { id: udfMetaByName.get('z_f_sc_request_status').id },
          value: APPROVAL_STATUS.ChangeRequired,
        },
        {
          meta: { id: udfMetaByName.get('z_f_sc_request_cena').id },
          value: disputeCost,
        },
        {
          meta: { id: udfMetaByName.get('z_f_sc_request_poznamka').id },
          value: disputeComment,
        },
        {
          meta: { id: udfMetaByName.get('z_f_sc_request_datum').id },
          value: now,
        },
      ],
    }));

    const responseForUpdate = await fetch(
      'https://eu.coresuite.com/api/data/v4/ServiceCall/bulk?' + new URLSearchParams({
        ...await common.getSearchParams(),
        dtos: 'ServiceCall.26',
        forceUpdate: true,
      }),
      {
        method: 'PATCH',
        headers: await common.getHeaders(),
        body: JSON.stringify(updates),
      },
    );

    if (!responseForUpdate.ok) {
      throw new Error(`Failed to update ServiceCall, got status ${responseForUpdate.status}`);
    }

    disputeCostEl.value = '';
    disputeCommentEl.value = '';

    await renderTable();
  }

  function minutesToHHMM(minutes) {
    const minutes60 = minutes % 60;
    const hours = Math.floor(minutes / 60);
    return `${hours.toString().padStart(2, '0')}:${minutes60.toString().padStart(2, '2')}`;
  }

  return {
    selectBusinessPartner,
    searchBusinessPartner,
    selectPeriod,
    searchPeriod,
    approvePeriod,
    onNavigate,
    goToPage,
    goToPageArrow,
    filter,
    toggleSelectAll,
    acceptSelected,
    dismissSelected,
    disputeSelected,
  };
})();
