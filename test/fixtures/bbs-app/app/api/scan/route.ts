export async function POST(req: Request) {
  const body = await req.json();
  return Response.json({ ok: true, files: body.files?.length ?? 0 });
}
