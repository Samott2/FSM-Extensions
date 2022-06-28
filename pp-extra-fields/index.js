const CLIENT_ID = 'fsm-ext-pp-extra-fields'
const CLIENT_VERSION = '1.0.0'
let SHELL_SDK = null;

async function getHeaders() {
  const context = await getContext();
  return {
    'Accept': 'application/json',
    'Authorization': `Bearer ${context.auth.access_token}`,
    'Content-Type': 'application/json',
    'X-Client-ID': CLIENT_ID,
    'X-Client-Version': CLIENT_VERSION,
  };
}

async function getSearchParams() {
  const context = await getContext();
  return {
    account: context.account,
    company: context.company,
  };
}

async function fetchData(activityId) {
  const response = await fetch(
    'https://eu.coresuite.com/api/query/v1?' + new URLSearchParams({
      ...await getSearchParams(),
      dtos: 'ServiceCall.26;Activity.39;BusinessPartner.23;Equipment.23;Address.21;Requirement.9;Tag.9',
      // pageSize: 1000,
      // page: 0,
    }),
    {
      method: 'POST',
      headers: await getHeaders(),
      body: JSON.stringify({
        query: `
          SELECT
            a.id AS activityId,
            sc.id AS serviceCallId,
            bp.name AS businessPartnerName,
            bp.code AS businessPartnerCode,
            sc.subject AS serviceCallSubject,
            sc.code AS serviceCallCode,
            a.code AS activityCode,
            sc.udf.z_f_sc_assignment AS serviceCallRemarks,
            sc.udf.z_f_sc_telefon AS serviceCallPhone,
            sc.udf.z_f_sc_email AS serviceCallEmail,
            address.street AS addressStreet,
            address.streetNo AS addressStreetNo,
            address.zipCode AS addressZipCode,
            address.city AS addressCity,
            t.name as requirement
          FROM ServiceCall sc
          JOIN Activity a
            ON sc = a.object
          JOIN BusinessPartner bp
            ON sc.businessPartner = bp.id
          JOIN Equipment e
            ON e.id IN sc.equipments
          JOIN Address address
            ON address.object = e
          JOIN Requirement r
            ON sc = r.object
          JOIN Tag t
            ON r.tag = t.id
          WHERE a.id = '${activityId}'
        `,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch data, got status ${response.status}`);
  }

  const body = await response.json();
  return body.data;
}

function group(entries) {
  return entries.reduce((acc, entry) => {
    return Object.entries(entry).reduce((acc, [fieldKey, fieldValue]) => {
      const currentValue = acc[fieldKey];
      if (currentValue === undefined) {
        acc[fieldKey] = fieldValue;
      } else if (Array.isArray(currentValue)) {
        if (!currentValue.includes(fieldValue)) {
          currentValue.push(fieldValue);
        }
      } else if (currentValue !== fieldValue) {
        acc[fieldKey] = [currentValue, fieldValue];
      }
      return acc;
    }, acc);
  });
}

function displayFields(entry) {
  document
    .querySelectorAll('[data-property]')
    .forEach(e => {
      const key = e.dataset.property;
      const value = entry[key];
      if (key === 'requirement') {
        e.innerHTML = Array.isArray(value) ? value.join('<br>') : value;
      } else {
        e.innerText = value;
      }
    });
}

let _CONTEXT = null;
let _CONTEXT_VALID_UNTIL = null;
function getContext() {
  const { SHELL_EVENTS } = FSMShell;

  if (_CONTEXT && Date.now() < _CONTEXT_VALID_UNTIL) {
    return Promise.resolve(_CONTEXT);
  }

  console.debug('Requesting context');
  return new Promise((rs) => {
    SHELL_SDK.emit(SHELL_EVENTS.Version1.REQUIRE_CONTEXT, {
      clientIdentifier: CLIENT_ID,
      auth: {
        response_type: 'token'
      },
    });

    SHELL_SDK.on(SHELL_EVENTS.Version1.REQUIRE_CONTEXT, (event) => {
      console.debug('Received context');
      _CONTEXT = JSON.parse(event);
      _CONTEXT_VALID_UNTIL = Date.now() + _CONTEXT.auth.expires_in * 1000 - 3000;
      rs(_CONTEXT);
    });
  });
}

async function withErrorHandling(fn) {
  try {
    return await fn();
  } catch (err) {
    console.error(err);
  }
}

async function main() {
  const { ShellSdk, SHELL_EVENTS } = FSMShell;

  if (ShellSdk.isInsideShell()) {
    SHELL_SDK = ShellSdk.init(parent, '*');

    SHELL_SDK.emit(SHELL_EVENTS.Version1.REQUIRE_CONTEXT, {
      clientIdentifier: CLIENT_ID,
      auth: {
        response_type: 'token',
      },
    });

    SHELL_SDK.on(SHELL_EVENTS.Version1.REQUIRE_CONTEXT, async (context) => {
      context = JSON.parse(context);
      const data = await fetchData(context.viewState.activityID);
      const grouped = await group(data);
      displayFields(grouped);
    });
  } else {
    throw new Error('Unable to reach shell event API');
  }
}

main();
