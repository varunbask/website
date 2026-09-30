// A grading failure that retrying will not fix (unreadable file, wrong type,
// scanned PDF). The message is shown to tutors and students, so keep it plain.
export class PermanentGradingError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PermanentGradingError';
  }
}
