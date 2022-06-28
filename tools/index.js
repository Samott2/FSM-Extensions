(() => {
  let canAccessUdoMetaPromise = null;
  const onNavigate = async () => {
    const canAccessUdoMetaResult = await (canAccessUdoMetaPromise || (canAccessUdoMetaPromise = common.canAccessUdoMeta()));
    if (!canAccessUdoMetaResult) {
      return ui.showAccessRejectedDialog();
    }
  }

  const ROUTES = ((allRoutes) => {
    const routeIdToPath = new Map(allRoutes.map(route => [route.sectionId, route]));
    const routePathToId = new Map(allRoutes.map(route => [route.path, route]));
    const fallback = allRoutes.find(route => route.fallback);
    return {
      getById: id => routeIdToPath.get(id),
      getByPath: path => routePathToId.get(path),
      fallback,
    };
  })([
    { path: '/', sectionId: 'section-warehouse' },
    { path: '/price-list', sectionId: 'section-price-list', onNavigate },
    { path: '/authorization-supplier', sectionId: 'section-authorization-supplier', onNavigate },
    { path: '/approval', sectionId: 'section-approval', onNavigate: approval.onNavigate, },
    { path: '/warehouse', sectionId: 'section-warehouse', onNavigate: warehouse.onNavigate, },
    { path: '/not-found', sectionId: 'section-not-found', fallback: true },
  ]);

  function route() {
    const currentPath = location.hash.slice(1).toLowerCase() || '/';
    const currentRoute = ROUTES.getByPath(currentPath) || ROUTES.fallback;

    const shownSections = document
      .getElementById('extension-main')
      .getElementsByClassName('section-shown');

    Array.prototype.forEach.call(shownSections || [], e => {
      e.classList.add('section-hidden');
      e.classList.remove('section-shown');
    });

    document.getElementById(currentRoute.sectionId).classList.add('section-shown');
    document.getElementById(currentRoute.sectionId).classList.remove('section-hidden');
    ui.hideAccessRejectedDialog();

    currentRoute.onNavigate && currentRoute.onNavigate();
  }

  function navigateToPath(path) {
    if (ShellSdk.isInsideShell()) {
      LuigiClient.linkManager().withoutSync().fromClosestContext().navigate(path);
    }
  }

  function initRouting() {
    window.addEventListener('popstate', route);
    window.addEventListener('hashchange', route);
    window.addEventListener('load', route);
    route();
  }

  async function bootstrap() {
    const { ShellSdk } = FSMShell;

    if (ShellSdk.isInsideShell()) {
      common.setShellSdk(ShellSdk.init(parent, '*'));

      initRouting();

      window.addEventListener('beforeunload', ui.revokeDownloadUrls);
    } else {
      throw new Error('Unable to reach shell event API');
    }
  }

  bootstrap();
})();
