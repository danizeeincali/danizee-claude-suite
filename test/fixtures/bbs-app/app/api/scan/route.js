// POST /api/scan: accepts uploaded text and returns what was stored.
export async function POST(req) {
  const body = await req.json();
  return Response.json({ stored: body.text ?? '' });
}
