export const onRequest: PagesFunction = async (context) => {
  const url = new URL(context.request.url);
  const backendUrl = `https://weread-backend.sglinhome.workers.dev${url.pathname}${url.search}`;
  
  // 转发请求到已部署的后端 Worker
  return fetch(backendUrl, context.request.clone());
};
