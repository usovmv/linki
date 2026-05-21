import type { NextApiRequest, NextApiResponse } from "next";

const WRAPPER_URL = process.env.CLAUDE_WRAPPER_URL ?? "http://localhost:3001";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const upstream = await fetch(`${WRAPPER_URL}/accounts`);
    const data = await upstream.json();
    res.json(data);
  } catch {
    res.status(502).json({ error: "Could not reach cc-wrapper" });
  }
}
