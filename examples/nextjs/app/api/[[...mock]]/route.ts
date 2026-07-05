import { createNextHandlers, getMockContext, type NextRouteContext } from 'mockingpug/next';

const handlersPromise = getMockContext(process.cwd()).then(({ ctx }) => createNextHandlers(ctx));

export const GET = async (request: Request, routeCtx: NextRouteContext) => (await handlersPromise).GET(request, routeCtx);
export const POST = async (request: Request, routeCtx: NextRouteContext) => (await handlersPromise).POST(request, routeCtx);
export const PUT = async (request: Request, routeCtx: NextRouteContext) => (await handlersPromise).PUT(request, routeCtx);
export const PATCH = async (request: Request, routeCtx: NextRouteContext) => (await handlersPromise).PATCH(request, routeCtx);
export const DELETE = async (request: Request, routeCtx: NextRouteContext) => (await handlersPromise).DELETE(request, routeCtx);
