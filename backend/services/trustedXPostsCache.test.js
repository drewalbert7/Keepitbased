const axios = require('axios');
const {
  fetchTrustedPostsForHandles,
  invalidateTrustedPostsCache
} = require('./trustedXPostsCache');

jest.mock('axios');

describe('trustedXPostsCache', () => {
  beforeEach(() => {
    invalidateTrustedPostsCache();
    jest.clearAllMocks();
  });

  test('returns cached posts without second HTTP call', async () => {
    axios.post.mockResolvedValue({
      data: { posts: [{ monitor_username: 'alpha', snippet: '$NVDA' }] }
    });

    const first = await fetchTrustedPostsForHandles(['alpha']);
    expect(first.fromCache).toBe(false);
    expect(axios.post).toHaveBeenCalledTimes(1);

    const second = await fetchTrustedPostsForHandles(['alpha']);
    expect(second.fromCache).toBe(true);
    expect(second.posts).toHaveLength(1);
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  test('allowFetch false skips network on cache miss', async () => {
    const result = await fetchTrustedPostsForHandles(['beta'], { allowFetch: false });
    expect(result.skipped).toBe(true);
    expect(result.posts).toEqual([]);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('forceRefresh bypasses cache', async () => {
    axios.post.mockResolvedValue({ data: { posts: [{ monitor_username: 'gamma' }] } });

    await fetchTrustedPostsForHandles(['gamma']);
    await fetchTrustedPostsForHandles(['gamma'], { forceRefresh: true });

    expect(axios.post).toHaveBeenCalledTimes(2);
  });
});
