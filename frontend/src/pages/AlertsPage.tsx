import React from 'react';

const AlertsPage: React.FC = () => {
  return (
    <div className="mx-auto max-w-[1360px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-kib-fg">Alerts</h1>
        <p className="text-kib-muted mt-2">Manage your buy signal alerts</p>
      </div>
      
      <div className="card">
        <div className="text-center py-12">
          <h3 className="text-lg font-medium text-kib-fg mb-2">No alerts yet</h3>
          <p className="text-kib-muted mb-6">Create your first alert to start monitoring price drops</p>
          <button className="btn-primary">
            Create Alert
          </button>
        </div>
      </div>
    </div>
  );
};

export default AlertsPage;