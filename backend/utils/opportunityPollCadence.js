const { isUsStockRegularTradingHours } = require('./researchAlertGates');

/**
 * Stock quote polling: every minute during US RTH, sparser off-hours (crypto always every tick).
 * @param {Date} [now]
 * @param {number} [offHoursIntervalMin]
 */
function shouldPollStockSymbolThisCycle(now = new Date(), offHoursIntervalMin = 5) {
  if (isUsStockRegularTradingHours(now)) return true;
  const interval = Number(offHoursIntervalMin);
  if (!Number.isFinite(interval) || interval <= 1) return true;
  const minute = now.getUTCMinutes();
  return minute % interval === 0;
}

module.exports = {
  shouldPollStockSymbolThisCycle
};
