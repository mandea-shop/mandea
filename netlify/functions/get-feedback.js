// ============================================================
// MANDEA — Netlify Function: feedback.json von GitHub lesen
// GET → liefert nur freigegebene Bewertungen (approved: true)
// ============================================================

const HEADERS = {
  'Content-Type':                'application/json',
  'Cache-Control':               'no-store',
  'Access-Control-Allow-Origin': '*',
};

export const handler = async () => {
  const owner  = process.env.GITHUB_OWNER;
  const repo   = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH ?? 'main';
  const token  = process.env.GITHUB_TOKEN;

  if (!owner || !repo || !token) {
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Server-Konfigurationsfehler.' }) };
  }

  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/public/feedback.json?ref=${branch}`,
      {
        headers: {
          'Authorization':        `Bearer ${token}`,
          'Accept':               'application/vnd.github.raw+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      }
    );

    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const data = await res.json();
    const approved = (data.reviews ?? []).filter(r => r.approved === true && !r.archived);
    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({ reviews: approved }),
    };
  } catch (err) {
    console.error('get-feedback Fehler:', err.message);
    return { statusCode: 502, headers: HEADERS, body: JSON.stringify({ error: err.message }) };
  }
};
