(function initializeScholarHarnessModuleRuntime(global) {
  'use strict';

  if (global.ScholarHarnessModules) return;

  var records = Object.create(null);
  var listeners = [];

  function normalizeName(name) {
    return String(name || '').trim();
  }

  function register(name, metadata) {
    var normalizedName = normalizeName(name);
    if (!normalizedName) {
      throw new Error('Scholar Harness module name is required');
    }

    var previous = records[normalizedName] || {};
    var next = Object.assign({}, previous, metadata || {}, {
      name: normalizedName,
      loaded: true,
      loadedAt: new Date().toISOString()
    });
    records[normalizedName] = next;

    listeners.slice().forEach(function notify(listener) {
      try {
        listener(next);
      } catch (_) {
        // A diagnostics listener must never block application startup.
      }
    });

    return next;
  }

  function get(name) {
    return records[normalizeName(name)] || null;
  }

  function list() {
    return Object.keys(records).map(function toRecord(name) {
      return records[name];
    });
  }

  function isLoaded(name) {
    var record = get(name);
    return Boolean(record && record.loaded);
  }

  function onRegister(listener) {
    if (typeof listener !== 'function') return function noop() {};
    listeners.push(listener);
    return function unsubscribe() {
      listeners = listeners.filter(function keep(candidate) {
        return candidate !== listener;
      });
    };
  }

  global.ScholarHarnessModules = Object.freeze({
    get: get,
    isLoaded: isLoaded,
    list: list,
    onRegister: onRegister,
    register: register
  });
})(window);
