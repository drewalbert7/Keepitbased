import React from 'react';

const AlertsPage: React.FC = () => {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-robinhood-gray-900">Alerts</h1>
        <p className="text-robinhood-gray-600 mt-2">Manage your buy signal alerts</p>
      </div>
      
      <div className="card">
        <div className="text-center py-12">
          <h3 className="text-lg font-medium text-robinhood-gray-900 mb-2">No alerts yet</h3>
          <p className="text-robinhood-gray-600 mb-6">Create your first alert to start monitoring price drops</p>
          <button className="btn-primary">
            Create Alert
          </button>
        </div>
      </div>
    </div>
  );
};

export default AlertsPage;