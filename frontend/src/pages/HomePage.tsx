import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const HomePage: React.FC = () => {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [currentPrice, setCurrentPrice] = useState(236.45);
  const [isAnimating, setIsAnimating] = useState(false);

  // Simulate price movement for demo
  useEffect(() => {
    if (isAuthenticated) {
      navigate('/dashboard');
      return;
    }

    const interval = setInterval(() => {
      setIsAnimating(true);
      setCurrentPrice(prev => {
        const change = (Math.random() - 0.5) * 5;
        return Math.max(200, Math.min(300, prev + change));
      });
      setTimeout(() => setIsAnimating(false), 500);
    }, 3000);

    return () => clearInterval(interval);
  }, [isAuthenticated, navigate]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-robinhood-gray-50 via-white to-robinhood-gray-100">
      {/* Header */}
      <header className="relative z-10">
        <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center">
              <Link to="/" className="text-2xl font-bold text-robinhood-gray-900">
                KeepItBased
              </Link>
            </div>
            <div className="flex items-center space-x-4">
              <Link
                to="/login"
                className="text-robinhood-gray-600 hover:text-robinhood-gray-900 font-medium transition-colors duration-200"
              >
                Sign In
              </Link>
              <Link
                to="/register"
                className="bg-robinhood-green hover:bg-green-600 text-white font-medium py-2 px-4 rounded-lg transition-colors duration-200"
              >
                Get Started
              </Link>
            </div>
          </div>
        </nav>
      </header>

      {/* Hero Section */}
      <div className="relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="relative pt-20 pb-16 sm:pb-24">
            <div className="lg:grid lg:grid-cols-12 lg:gap-8">
              <div className="sm:text-center md:max-w-2xl md:mx-auto lg:col-span-6 lg:text-left lg:flex lg:items-center">
                <div>
                  <h1 className="text-4xl font-bold text-robinhood-gray-900 sm:text-5xl md:text-6xl">
                    Never Miss a
                    <span className="block text-robinhood-green">Buy the Dip</span>
                    Opportunity
                  </h1>
                  <p className="mt-6 text-xl text-robinhood-gray-600 sm:max-w-xl">
                    Get instant alerts when your favorite stocks and crypto hit your buy zones. 
                    Smart notifications for smarter investments.
                  </p>
                  <div className="mt-8 sm:max-w-lg sm:mx-auto sm:text-center lg:text-left">
                    <div className="flex flex-col sm:flex-row gap-4">
                      <Link 
                        to="/register"
                        className="btn-primary text-center text-lg py-4 px-8 shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200"
                      >
                        Start Investing Smarter
                      </Link>
                      <Link
                        to="/charts"
                        className="btn-secondary text-center text-lg py-4 px-8 hover:shadow-lg transform hover:scale-105 transition-all duration-200"
                      >
                        View Charts
                      </Link>
                    </div>
                    <p className="mt-4 text-sm text-robinhood-gray-500">
                      Free forever. No hidden fees. No commitments.
                    </p>
                  </div>
                </div>
              </div>
              
              {/* Mock Phone/Dashboard Preview */}
              <div className="mt-12 relative lg:mt-0 lg:col-span-6 lg:flex lg:items-center lg:justify-end">
                <div className="relative mx-auto w-full max-w-md lg:max-w-none">
                  <div className="relative bg-white rounded-3xl shadow-2xl p-8 border border-robinhood-gray-200">
                    <div className="text-center mb-6">
                      <h3 className="text-lg font-semibold text-robinhood-gray-900">AAPL Alert</h3>
                      <p className="text-sm text-robinhood-gray-600">Apple Inc.</p>
                    </div>
                    
                    <div className="space-y-4">
                      <div className="bg-gradient-to-r from-robinhood-green/10 to-robinhood-green/5 rounded-xl p-4 border-l-4 border-robinhood-green">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium text-robinhood-gray-600">Current Price</p>
                            <p className={`text-2xl font-bold transition-all duration-500 ${isAnimating ? 'scale-110' : ''}`}>
                              ${currentPrice.toFixed(2)}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-medium text-robinhood-gray-600">Drop</p>
                            <p className="text-lg font-bold text-robinhood-green">-12.5%</p>
                          </div>
                        </div>
                      </div>
                      
                      <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
                        <div className="flex items-center">
                          <div className="w-3 h-3 bg-yellow-400 rounded-full mr-3 animate-pulse"></div>
                          <p className="text-sm font-medium text-yellow-800">
                            🟡 Medium Buy Signal Triggered
                          </p>
                        </div>
                        <p className="text-xs text-yellow-700 mt-1">
                          Price dropped below your 10% threshold
                        </p>
                      </div>
                      
                      <button className="w-full bg-robinhood-green hover:bg-green-600 text-white font-semibold py-3 px-4 rounded-lg transition-colors duration-200">
                        View in App
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Section */}
      <div className="bg-robinhood-gray-900 text-white py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            <div>
              <p className="text-3xl font-bold text-robinhood-green">10K+</p>
              <p className="text-robinhood-gray-400">Active Users</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-robinhood-green">50M+</p>
              <p className="text-robinhood-gray-400">Alerts Sent</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-robinhood-green">2.5K+</p>
              <p className="text-robinhood-gray-400">Assets Tracked</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-robinhood-green">94%</p>
              <p className="text-robinhood-gray-400">Success Rate</p>
            </div>
          </div>
        </div>
      </div>

      {/* Features Section */}
      <div className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <h2 className="text-3xl font-bold text-robinhood-gray-900 sm:text-4xl">
              Smart Alerts for Smart Investors
            </h2>
            <p className="mt-4 text-xl text-robinhood-gray-600">
              Three levels of buy signals to match your investment strategy
            </p>
          </div>
          
          <div className="mt-16 grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {/* Small Dip Alert */}
            <div className="relative group">
              <div className="bg-gradient-to-br from-yellow-50 to-yellow-100 rounded-2xl p-8 border-2 border-yellow-200 hover:border-yellow-300 transition-all duration-300 group-hover:shadow-lg">
                <div className="w-12 h-12 bg-yellow-400 rounded-xl flex items-center justify-center mb-6">
                  <span className="text-2xl">🟡</span>
                </div>
                <h3 className="text-xl font-bold text-robinhood-gray-900 mb-3">Small Dip Alert</h3>
                <p className="text-robinhood-gray-600 mb-4">
                  Get notified when prices drop 5% from your baseline. Perfect for regular accumulation.
                </p>
                <ul className="space-y-2 text-sm text-robinhood-gray-600">
                  <li className="flex items-center">
                    <svg className="w-4 h-4 text-yellow-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    5% price drop threshold
                  </li>
                  <li className="flex items-center">
                    <svg className="w-4 h-4 text-yellow-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    Email & push notifications
                  </li>
                </ul>
              </div>
            </div>
            
            {/* Medium Dip Alert */}
            <div className="relative group">
              <div className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-2xl p-8 border-2 border-orange-200 hover:border-orange-300 transition-all duration-300 group-hover:shadow-lg transform group-hover:scale-105">
                <div className="w-12 h-12 bg-orange-400 rounded-xl flex items-center justify-center mb-6">
                  <span className="text-2xl">🟠</span>
                </div>
                <h3 className="text-xl font-bold text-robinhood-gray-900 mb-3">Medium Dip Alert</h3>
                <p className="text-robinhood-gray-600 mb-4">
                  Significant 10% drops signal strong buying opportunities with higher potential returns.
                </p>
                <ul className="space-y-2 text-sm text-robinhood-gray-600">
                  <li className="flex items-center">
                    <svg className="w-4 h-4 text-orange-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    10% price drop threshold
                  </li>
                  <li className="flex items-center">
                    <svg className="w-4 h-4 text-orange-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    Priority notifications
                  </li>
                </ul>
                <div className="absolute -top-3 -right-3 bg-robinhood-green text-white text-xs font-bold px-3 py-1 rounded-full">
                  POPULAR
                </div>
              </div>
            </div>
            
            {/* Large Dip Alert */}
            <div className="relative group">
              <div className="bg-gradient-to-br from-red-50 to-red-100 rounded-2xl p-8 border-2 border-red-200 hover:border-red-300 transition-all duration-300 group-hover:shadow-lg">
                <div className="w-12 h-12 bg-red-400 rounded-xl flex items-center justify-center mb-6">
                  <span className="text-2xl">🔴</span>
                </div>
                <h3 className="text-xl font-bold text-robinhood-gray-900 mb-3">Large Dip Alert</h3>
                <p className="text-robinhood-gray-600 mb-4">
                  Major 15%+ crashes create exceptional buying opportunities for long-term investors.
                </p>
                <ul className="space-y-2 text-sm text-robinhood-gray-600">
                  <li className="flex items-center">
                    <svg className="w-4 h-4 text-red-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    15% price drop threshold
                  </li>
                  <li className="flex items-center">
                    <svg className="w-4 h-4 text-red-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    Instant alerts
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* How It Works Section */}
      <div className="py-20 bg-robinhood-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <h2 className="text-3xl font-bold text-robinhood-gray-900 sm:text-4xl">
              How KeepItBased Works
            </h2>
            <p className="mt-4 text-xl text-robinhood-gray-600">
              Set up your alerts in minutes and never miss a dip again
            </p>
          </div>
          
          <div className="mt-16">
            <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
              <div className="text-center">
                <div className="bg-robinhood-green/10 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6">
                  <svg className="w-8 h-8 text-robinhood-green" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold text-robinhood-gray-900 mb-3">1. Add Your Favorites</h3>
                <p className="text-robinhood-gray-600">
                  Search and add stocks and crypto you want to track. Set your custom thresholds for each asset.
                </p>
              </div>
              
              <div className="text-center">
                <div className="bg-robinhood-green/10 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6">
                  <svg className="w-8 h-8 text-robinhood-green" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-5 5v-5zM4.02 18.85C2.32 17.4 1.15 15.32 1 13c-.5-5.5 4.5-10 10-10s10.5 4.5 10 10c-.15 2.32-1.32 4.4-3.02 5.85" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold text-robinhood-gray-900 mb-3">2. We Monitor 24/7</h3>
                <p className="text-robinhood-gray-600">
                  Our system continuously tracks prices across all major exchanges and alerts you when opportunities arise.
                </p>
              </div>
              
              <div className="text-center">
                <div className="bg-robinhood-green/10 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6">
                  <svg className="w-8 h-8 text-robinhood-green" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold text-robinhood-gray-900 mb-3">3. Get Instant Alerts</h3>
                <p className="text-robinhood-gray-600">
                  Receive beautiful email alerts and push notifications the moment your buy opportunities hit.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Testimonial Section */}
      <div className="py-20 bg-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <h2 className="text-3xl font-bold text-robinhood-gray-900 sm:text-4xl mb-16">
              Trusted by Smart Investors
            </h2>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="bg-robinhood-gray-50 rounded-2xl p-8">
              <div className="flex items-center mb-4">
                <div className="w-12 h-12 bg-robinhood-green rounded-full flex items-center justify-center text-white font-bold text-lg mr-4">
                  S
                </div>
                <div>
                  <p className="font-semibold text-robinhood-gray-900">Sarah Chen</p>
                  <p className="text-sm text-robinhood-gray-600">Day Trader</p>
                </div>
              </div>
              <p className="text-robinhood-gray-700 italic">
                "KeepItBased has completely changed how I invest. I caught TSLA's 18% dip last month and made incredible returns. The alerts are always on time!"
              </p>
              <div className="flex text-robinhood-green mt-4">
                {'★'.repeat(5)}
              </div>
            </div>
            
            <div className="bg-robinhood-gray-50 rounded-2xl p-8">
              <div className="flex items-center mb-4">
                <div className="w-12 h-12 bg-robinhood-green rounded-full flex items-center justify-center text-white font-bold text-lg mr-4">
                  M
                </div>
                <div>
                  <p className="font-semibold text-robinhood-gray-900">Mike Rodriguez</p>
                  <p className="text-sm text-robinhood-gray-600">Long-term Investor</p>
                </div>
              </div>
              <p className="text-robinhood-gray-700 italic">
                "As a busy professional, I can't watch the markets all day. KeepItBased ensures I never miss a buying opportunity. It's like having a personal market assistant."
              </p>
              <div className="flex text-robinhood-green mt-4">
                {'★'.repeat(5)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* CTA Section */}
      <div className="bg-gradient-to-r from-robinhood-green to-green-600 py-20">
        <div className="max-w-4xl mx-auto text-center px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-white sm:text-4xl">
            Start Buying the Dip Like a Pro
          </h2>
          <p className="mt-6 text-xl text-green-100">
            Join thousands of investors who never miss a buying opportunity
          </p>
          <div className="mt-10">
            <Link
              to="/register"
              className="bg-white text-robinhood-green font-bold text-lg py-4 px-10 rounded-xl hover:bg-green-50 transition-colors duration-200 shadow-lg hover:shadow-xl transform hover:scale-105 inline-block"
            >
              Get Started Free
            </Link>
          </div>
          <p className="mt-6 text-sm text-green-100">
            No credit card required • Free forever • Cancel anytime
          </p>
        </div>
      </div>

      {/* Footer */}
      <footer className="bg-robinhood-gray-900 text-white py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            <div>
              <h3 className="font-bold text-lg mb-4">Product</h3>
              <ul className="space-y-2 text-robinhood-gray-400">
                <li><Link to="/charts" className="hover:text-white transition-colors">Charts</Link></li>
                <li><Link to="/register" className="hover:text-white transition-colors">Alerts</Link></li>
                <li><Link to="/register" className="hover:text-white transition-colors">Portfolio</Link></li>
              </ul>
            </div>
            <div>
              <h3 className="font-bold text-lg mb-4">Company</h3>
              <ul className="space-y-2 text-robinhood-gray-400">
                <li><a href="#" className="hover:text-white transition-colors">About</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Careers</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Blog</a></li>
              </ul>
            </div>
            <div>
              <h3 className="font-bold text-lg mb-4">Support</h3>
              <ul className="space-y-2 text-robinhood-gray-400">
                <li><a href="#" className="hover:text-white transition-colors">Help Center</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Contact</a></li>
                <li><a href="#" className="hover:text-white transition-colors">API</a></li>
              </ul>
            </div>
            <div>
              <h3 className="font-bold text-lg mb-4">Legal</h3>
              <ul className="space-y-2 text-robinhood-gray-400">
                <li><a href="#" className="hover:text-white transition-colors">Privacy</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Terms</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Disclosures</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-robinhood-gray-800 mt-12 pt-8 text-center">
            <p className="text-robinhood-gray-400">
              © 2024 KeepItBased. All rights reserved. Never miss a dip again.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default HomePage;