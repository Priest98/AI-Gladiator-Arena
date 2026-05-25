// Vercel Serverless Function entry point
// Wraps the Express app for serverless deployment using dynamic import for ES modules compatibility.
const appPromise = import('../server/server.js');

export default async function handler(req, res) {
  const appModule = await appPromise;
  return appModule.default(req, res);
}
