import React from 'react';
import { Link } from 'react-router-dom';

const NotFound: React.FC = () => {
  return (
    <div className="p-6 flex flex-col items-center justify-center min-h-[60vh]">
      <h1 className="text-4xl font-bold text-slate-100">404 - Page Not Found</h1>
      <p className="mt-2 text-slate-400">The page you are looking for does not exist.</p>
      <Link to="/" className="mt-4 px-4 py-2 bg-sky-600 hover:bg-sky-500 rounded text-white font-medium">
        Back to Dashboard
      </Link>
    </div>
  );
};

export default NotFound;
