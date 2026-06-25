import React from 'react';
import './loading.scss';

export const Loading: React.FC = () => {
  return (
    <div className="w-full h-full flex justify-center items-center pb-8">
      <div className="cube-grid-loading">
        <div className="cube"></div>
        <div className="cube"></div>
        <div className="cube"></div>
        <div className="cube"></div>
        <div className="cube"></div>
        <div className="cube"></div>
        <div className="cube"></div>
        <div className="cube"></div>
        <div className="cube"></div>
      </div>
    </div>
  );
};
