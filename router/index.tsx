import { Suspense, lazy, useEffect } from 'react';
import { useNavigate, useRoutes } from 'react-router-dom';
import type { ReactElement } from 'react';
import { Loading } from '@/components/Loading/index';

// Each route's bundle is fetched on demand. The reader page in particular
// pulls in EPUB parsing, the worker glue, and large rendering modules, so
// keeping it out of the initial chunk meaningfully cuts time-to-interactive.
const Home = lazy(() => import('@/pages/home/index').then((m) => ({ default: m.Home })));
const BookDetail = lazy(() => import('@/pages/book-detail/index').then((m) => ({ default: m.BookDetail })));
const Shelf = lazy(() => import('@/pages/shelf/index').then((m) => ({ default: m.Shelf })));

export enum ROUTE_PATH {
  HOME = '/',
  READER = '/reader',
  SHELF = '/shelf',
  LOADING = '/loading',
}

export const createReaderPath = (bookId: string | number): string => `${ROUTE_PATH.READER}/${encodeURIComponent(bookId)}`;

const Redirect = ({ to, replace, state }: { replace?: boolean; state?: object; to: string }): ReactElement => {
  const navigate = useNavigate();
  useEffect(() => {
    navigate(to, { replace, state });
  }, [navigate, to, replace, state]);

  return <Loading />;
};

const withSuspense = (element: ReactElement): ReactElement => <Suspense fallback={<Loading />}>{element}</Suspense>;

export const Routes = (): ReactElement | null => {
  const defaultRoute = [
    {
      path: ROUTE_PATH.HOME,
      element: withSuspense(<Home />),
    },
    {
      path: `${ROUTE_PATH.READER}/:bookId`,
      element: withSuspense(<BookDetail />),
    },
    {
      path: ROUTE_PATH.SHELF,
      element: withSuspense(<Shelf />),
    },
    {
      path: ROUTE_PATH.LOADING,
      element: <Loading />,
    },
    {
      path: '*',
      element: <Redirect to={ROUTE_PATH.HOME} />,
    },
  ];
  const routes = [...defaultRoute];
  return useRoutes(routes);
};
