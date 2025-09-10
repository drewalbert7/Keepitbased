import React from 'react';

const Dashboard: React.FC = () => {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-robinhood-gray-900">Dashboard</h1>
        <p className="text-robinhood-gray-600 mt-2">Monitor your alerts and market opportunities</p>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="card">
          <h3 className="text-lg font-semibold text-robinhood-gray-900 mb-2">Active Alerts</h3>
          <p className="text-3xl font-bold text-robinhood-green">0</p>
          <p className="text-sm text-robinhood-gray-600">Monitoring your portfolio</p>
        </div>
        
        <div className="card">
          <h3 className="text-lg font-semibold text-robinhood-gray-900 mb-2">Today's Signals</h3>
          <p className="text-3xl font-bold text-robinhood-red">0</p>
          <p className="text-sm text-robinhood-gray-600">Buy opportunities today</p>
        </div>
        
        <div className="card">
          <h3 className="text-lg font-semibold text-robinhood-gray-900 mb-2">Total Saved</h3>
          <p className="text-3xl font-bold text-robinhood-gray-900">$0</p>
          <p className="text-sm text-robinhood-gray-600">Estimated savings from alerts</p>
        </div>
      </div>

      <div className="mt-8 card">
        <h3 className="text-xl font-semibold text-robinhood-gray-900 mb-4">Getting Started</h3>
        <div className="space-y-4">
          <div className="p-4 bg-robinhood-gray-50 rounded-lg">
            <h4 className="font-medium text-robinhood-gray-900">1. Set up your first alert</h4>
            <p className="text-sm text-robinhood-gray-600 mt-1">
              Choose a crypto or stock you want to monitor and set your buy signal thresholds.
            </p>
          </div>
          <div className="p-4 bg-robinhood-gray-50 rounded-lg">
            <h4 className="font-medium text-robinhood-gray-900">2. Customize your thresholds</h4>
            <p className="text-sm text-robinhood-gray-600 mt-1">
              Set small (5%), medium (10%), and large (15%) drop alerts to match your strategy.
            </p>
          </div>
          <div className="p-4 bg-robinhood-gray-50 rounded-lg">
            <h4 className="font-medium text-robinhood-gray-900">3. Get notified</h4>
            <p className="text-sm text-robinhood-gray-600 mt-1">
              Receive real-time alerts when prices drop and it's time to buy the dip!
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;