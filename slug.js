// Stable key for a show, derived from its title.
//
// Shared by build.js (which renders marks) and status-api.js (which writes
// them). Two copies of this function drifting apart would silently orphan every
// mark, so it lives in one place despite being four lines.

module.exports = title => String(title).toLowerCase()
  .normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');
