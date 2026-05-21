import type { NextApiRequest, NextApiResponse } from "next";

export function requireMcpAuth(req: NextApiRequest, res: NextApiResponse): boolean {
  const apiKey = process.env.MCP_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "MCP_API_KEY not configured on server" });
    return false;
  }
  const auth = req.headers["authorization"];
  if (!auth || auth !== `Bearer ${apiKey}`) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}
