// W1-J02 (12 Nov 2026): password rule for new passwords (sign-up and reset).
// Must match backend/api/auth_router.py::_password_problem.
export const PASSWORD_RULE_MSG =
  'Password must be at least 8 characters and include an uppercase letter, a number and a symbol.';

export const PASSWORD_RULES: { key: string; label: string; test: (p: string) => boolean }[] = [
  { key: 'length', label: 'At least 8 characters', test: p => p.length >= 8 },
  { key: 'upper', label: 'An uppercase letter (A-Z)', test: p => /[A-Z]/.test(p) },
  { key: 'number', label: 'A number (0-9)', test: p => /[0-9]/.test(p) },
  { key: 'symbol', label: 'A symbol, for example ! @ # $', test: p => /[^A-Za-z0-9]/.test(p) },
];

export function passwordMeetsRule(p: string): boolean {
  return PASSWORD_RULES.every(r => r.test(p));
}
