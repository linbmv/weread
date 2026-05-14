import { useEffect } from 'react';
import { useNavigate, useRoutes } from 'react-router-dom';
import type { ReactElement } from 'react';
import { Loading } from '@/components/Loading/index';
import { Home } from '@/pages/home/index';
import { BookDetail } from '@/pages/book-detail/index';
import { Shelf } from '@/pages/shelf/index';

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

export const Routes = (): ReactElement | null => {
  const defaultRoute = [
    {
      path: ROUTE_PATH.HOME,
      element: <Home />,
    },
    {
      path: `${ROUTE_PATH.READER}/:bookId`,
      element: <BookDetail />,
    },
    {
      path: ROUTE_PATH.SHELF,
      element: <Shelf />,
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
