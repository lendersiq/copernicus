/**
 * Shared customer directory lookups (normalized id keys + numeric aliases).
 */
(function (global) {
  'use strict';

  var LA = global.Copernicus;
  if (!LA) return;

  function lookupCustomerDirectoryName(dir, val) {
    if (!dir || val == null || val === '') return '';
    var loader = global.CSVLoader;
    var k = loader && loader.getNormalizedCustomerId
      ? loader.getNormalizedCustomerId(val)
      : String(val).trim();
    if (!k) return '';
    if (dir[k] != null) return String(dir[k]).trim();
    var n = Number(String(k).replace(/,/g, ''));
    if (!isNaN(n) && isFinite(n) && Math.abs(n) < 1e15) {
      var ik = String(Math.round(n));
      if (dir[ik] != null) return String(dir[ik]).trim();
    }
    return '';
  }

  /**
   * Match a loan/mortgage account row to a display name: mapped ids, then any raw cell
   * (handles mis-mapped customerId when another column still holds the relationship key).
   */
  function resolveLoanCustomerNameFromDirectory(acc, dir) {
    if (!acc || !dir || typeof dir !== 'object') return '';
    var nm = lookupCustomerDirectoryName(dir, acc.customerId);
    if (nm) return nm;
    nm = lookupCustomerDirectoryName(dir, acc.accountId);
    if (nm) return nm;
    var raw = acc.raw;
    if (!Array.isArray(raw)) return '';
    for (var i = 0; i < raw.length; i++) {
      nm = lookupCustomerDirectoryName(dir, raw[i]);
      if (nm) return nm;
    }
    return '';
  }

  LA.tools = LA.tools || {};
  LA.tools.lookupCustomerDirectoryName = lookupCustomerDirectoryName;
  LA.tools.resolveLoanCustomerNameFromDirectory = resolveLoanCustomerNameFromDirectory;
})(typeof window !== 'undefined' ? window : this);
