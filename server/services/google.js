// STUB — owner: Ali. Google Calendar via googleapis (I3).
/* eslint-disable no-unused-vars */
async function getBusy({ ws, userId, from, to }) { return { status: 'not_connected', busy: [] }; }
async function createEvent(args) { throw new Error('Google Calendar not implemented yet'); }
async function updateEvent(args) { throw new Error('Google Calendar not implemented yet'); }
async function deleteEvent(args) { throw new Error('Google Calendar not implemented yet'); }
module.exports = { getBusy, createEvent, updateEvent, deleteEvent };
