// What the public is allowed to see about a deal, and whether it can still be joined.
export function isJoinable(deal, now) {
  return ['open', 'charging', 'ready_to_order'].includes(deal.status) && now < new Date(deal.deadline);
}

export function publicDealState(deal, count, now) {
  return {
    status: deal.status,
    count,
    minBuyers: deal.min_buyers,
    remaining: Math.max(0, deal.min_buyers - count),
    percent: Math.min(100, Math.round((count / deal.min_buyers) * 100)),
    minimumReached: deal.status !== 'open' && deal.status !== 'expired',
    cancelled: Boolean(deal.cancelled_at),
    deadline: deal.deadline,
    secondsLeft: Math.max(0, Math.floor((new Date(deal.deadline) - now) / 1000)),
    joinable: isJoinable(deal, now),
  };
}
