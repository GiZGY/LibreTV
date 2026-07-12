export function isAuthorized(req, token) {
  if (!token) return true;
  const header = req.headers.authorization || '';
  return header === `Bearer ${token}`;
}
