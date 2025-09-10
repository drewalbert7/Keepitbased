import React, { useState, useEffect, useRef } from 'react';

interface TimeScaleOption {
  value: string;
  label: string;
  interval: string;
  days?: number;
}

interface TradingViewTimelineProps {
  onTimeScaleChange: (scale: string, interval: string) => void;
  currentScale: string;
  currentInterval: string;
}

const TimeScaleOptions: TimeScaleOption[] = [
  { value: '1D', label: '1D', interval: '5m', days: 1 },
  { value: '5D', label: '5D', interval: '15m', days: 5 },
  { value: '1M', label: '1M', interval: '1h', days: 30 },
  { value: '3M', label: '3M', interval: '1d', days: 90 },
  { value: '6M', label: '6M', interval: '1d', days: 180 },
  { value: 'YTD', label: 'YTD', interval: '1d', days: 365 },
  { value: '1Y', label: '1Y', interval: '1d', days: 365 },
  { value: '5Y', label: '5Y', interval: '1wk', days: 1825 },
  { value: 'ALL', label: 'All', interval: '1mo', days: 3650 },
];

export const TradingViewTimeline: React.FC<TradingViewTimelineProps> = ({
  onTimeScaleChange,
  currentScale,
  currentInterval,
}) => {
  const [isHovering, setIsHovering] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const timelineRef = useRef<HTMLDivElement>(null);

  // Get current date range based on selected scale
  const getDateRange = () => {
    const selected = TimeScaleOptions.find(opt => opt.value === currentScale);
    if (!selected) return '';

    const now = new Date();
    const startDate = new Date();

    if (selected.value === 'YTD') {
      startDate.setMonth(0, 1); // January 1st
    } else if (selected.days) {
      startDate.setDate(now.getDate() - selected.days);
    } else if (selected.value === '1Y' || selected.value === '5Y') {
      startDate.setFullYear(now.getFullYear() - (selected.value === '1Y' ? 1 : 5));
    }

    return `${startDate.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric' 
    })} - ${now.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: 'numeric'
    })}`;
  };

  const handleTimeScaleClick = (scale: string, interval: string) => {
    onTimeScaleChange(scale, interval);
    setShowMoreMenu(false);
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  return (
    <div 
      ref={timelineRef}
      className="flex items-center space-x-2 bg-gray-900 border-t border-b border-gray-800 px-4 py-2"
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      {/* Date Range Display */}
      <div className="text-sm text-gray-400 min-w-[180px]">
        {getDateRange()}
      </div>

      {/* Time Scale Buttons */}
      <div className="flex items-center space-x-1">
        {TimeScaleOptions.slice(0, 6).map((option) => (
          <button
            key={option.value}
            onClick={() => handleTimeScaleClick(option.value, option.interval)}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              currentScale === option.value
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            {option.label}
          </button>
        ))}
        
        {/* More Button */}
        <div className="relative">
          <button
            onClick={() => setShowMoreMenu(!showMoreMenu)}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              currentScale === 'ALL'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            More
          </button>
          
          {showMoreMenu && (
            <div className="absolute bottom-full left-0 mb-2 bg-gray-800 rounded-lg shadow-lg border border-gray-700 min-w-[120px] z-50">
              {TimeScaleOptions.slice(6).map((option) => (
                <button
                  key={option.value}
                  onClick={() => handleTimeScaleClick(option.value, option.interval)}
                  className={`w-full text-left px-3 py-2 text-xs font-medium hover:bg-gray-700 transition-colors ${
                    currentScale === option.value
                      ? 'text-blue-400 bg-gray-700'
                      : 'text-gray-300'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Zoom Controls */}
      <div className="flex items-center space-x-1 ml-auto">
        <button
          onClick={() => {
            const chartContainer = document.querySelector('.lightweight-charts');
            if (chartContainer) {
              // Zoom in logic would be handled by the parent chart component
              console.log('Zoom in requested');
            }
          }}
          className="p-1 text-gray-400 hover:text-white hover:bg-gray-800 rounded transition-colors"
          title="Zoom In (+)"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
        </button>
        
        <button
          onClick={() => {
            const chartContainer = document.querySelector('.lightweight-charts');
            if (chartContainer) {
              // Reset zoom logic would be handled by the parent chart component
              console.log('Reset zoom requested');
            }
          }}
          className="p-1 text-gray-400 hover:text-white hover:bg-gray-800 rounded transition-colors"
          title="Reset (0)"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
        
        <button
          onClick={() => {
            const chartContainer = document.querySelector('.lightweight-charts');
            if (chartContainer) {
              // Zoom out logic would be handled by the parent chart component
              console.log('Zoom out requested');
            }
          }}
          className="p-1 text-gray-400 hover:text-white hover:bg-gray-800 rounded transition-colors"
          title="Zoom Out (-)"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
          </svg>
        </button>
      </div>

      {/* Timeline Controls */}
      <div className="flex items-center space-x-2 text-xs text-gray-400">
        <span className="hidden sm:inline">Zoom: <kbd className="px-1 py-0.5 bg-gray-700 rounded">+</kbd> <kbd className="px-1 py-0.5 bg-gray-700 rounded">0</kbd> <kbd className="px-1 py-0.5 bg-gray-700 rounded">-</kbd></span>
      </div>
    </div>
  );
};

export default TradingViewTimeline;