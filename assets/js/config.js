/*
 * Site settings — the one file to edit after setup (see README.md).
 *
 * formEndpoint: your Google Apps Script web app URL (it ends in /exec).
 *   While it is empty, the details form runs in preview mode: guests can click
 *   through every step, but nothing is saved.
 */
window.SAVE_THE_DATE_CONFIG = {
  formEndpoint: 'https://script.google.com/macros/s/AKfycbwhGItJwUd7FqQEAIsyXOA70RpYLX-8YIyMDL1yN7zGppw7xRNVqo1GNsXpP-zAn3lQ/exec',

  // Sunday, April 18, 2027 at 4:00 PM Eastern (EDT is UTC-4 in April)
  weddingDateISO: '2027-04-18T16:00:00-04:00',
};
