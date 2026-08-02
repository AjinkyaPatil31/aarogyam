/**
 * Shared age calculation helper.
 *
 * Age is ALWAYS computed on the fly from the patient's Date of Birth at the
 * time a prescription is generated. It is never manually entered and never
 * stored in the database.
 *
 * Handles the standard birthday edge cases:
 *  - birthday later this year  -> one less than year-difference
 *  - birthday today            -> birthday already occurred (age counted)
 *  - leap-year birthdays (Feb 29) -> treated correctly in non-leap years
 *
 * @param {string|null|undefined} dateOfBirth  ISO date string (YYYY-MM-DD)
 * @param {Date|string|number} [referenceDate]  Date to compute the age
 *   against (defaults to "now" — i.e. the moment the prescription is generated).
 * @returns {number|null}  Age in years, or null when DOB is missing/invalid.
 */
export function calculateAge(dateOfBirth, referenceDate = new Date()) {
  if (!dateOfBirth) return null;
  const birth = new Date(dateOfBirth);
  if (Number.isNaN(birth.getTime())) return null;

  const today = new Date(referenceDate);
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}
