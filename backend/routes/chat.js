const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const auth = require('../middleware/auth');
const db = require('../models/database');
const logger = require('../utils/logger');
const { getAdminClient, isChatConfigured } = require('../services/supabaseChat');
const { getLinkPreview } = require('../services/chatLinkPreview');

const router = express.Router();

const ALLOWED_REACTIONS = new Set(['👍', '❤️', '😂', '🎉', '🔥', '👀', '🙏', '💯']);

const messageLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many chat messages; try again shortly.'
});

const reactionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false
});

const previewLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many link previews; try again shortly.'
});

function chat503(res) {
  return res.status(503).json({ message: 'Live chat is not configured on this server.' });
}

async function loadDisplayName(userId) {
  const r = await db.query(
    `SELECT username, first_name, last_name, email FROM users WHERE id = $1`,
    [userId]
  );
  if (!r.rows.length) return 'User';
  const row = r.rows[0];
  const un = (row.username || '').trim();
  if (un) return un.slice(0, 120);
  const fn = (row.first_name || '').trim();
  const ln = (row.last_name || '').trim();
  const combined = `${fn} ${ln}`.trim();
  if (combined) return combined.slice(0, 120);
  const em = String(row.email || '').trim();
  if (em) return em.split('@')[0].slice(0, 120);
  return 'User';
}

/** GET /api/chat/messages?limit=50&before=ISO */
router.get('/messages', auth, async (req, res) => {
  if (!isChatConfigured()) return chat503(res);
  const supabase = getAdminClient();
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const before = typeof req.query.before === 'string' ? req.query.before.trim() : '';

  let q = supabase
    .from('chat_messages')
    .select(
      `id, user_id, display_name, body, created_at,
       chat_reactions ( id, user_id, emoji )`
    )
    .order('created_at', { ascending: false })
    .limit(limit);

  if (before) {
    q = q.lt('created_at', before);
  }

  const { data, error } = await q;
  if (error) {
    logger.error('chat list messages', error);
    return res.status(500).json({ message: 'Could not load messages' });
  }

  const rows = (data || []).map((m) => ({
    id: m.id,
    userId: m.user_id,
    displayName: m.display_name,
    body: m.body,
    createdAt: m.created_at,
    reactions: aggregateReactions(m.chat_reactions || [])
  }));

  res.json({ messages: rows.reverse() });
});

/** GET /api/chat/link-preview?url=https://… — Open Graph card for shared links */
router.get('/link-preview', auth, previewLimiter, async (req, res) => {
  const raw = typeof req.query.url === 'string' ? req.query.url.trim() : '';
  if (!raw || raw.length > 2048) {
    return res.status(400).json({ message: 'Valid url query parameter required' });
  }
  const result = await getLinkPreview(raw);
  if (!result.ok) {
    return res.status(400).json({ message: result.error || 'Could not preview link' });
  }
  return res.json({ preview: result.preview });
});

function aggregateReactions(reactionRows) {
  const map = new Map();
  for (const r of reactionRows) {
    const emoji = r.emoji;
    if (!map.has(emoji)) {
      map.set(emoji, { emoji, count: 0, userIds: [] });
    }
    const entry = map.get(emoji);
    entry.count += 1;
    entry.userIds.push(r.user_id);
  }
  return Array.from(map.values());
}

router.post(
  '/messages',
  auth,
  messageLimiter,
  [body('body').isString().trim().isLength({ min: 1, max: 2000 }).withMessage('Message 1–2000 characters')],
  async (req, res) => {
    if (!isChatConfigured()) return chat503(res);
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: errors.array()[0]?.msg || 'Invalid body' });
    }

    const supabase = getAdminClient();
    const userId = req.user.id;
    const displayName = await loadDisplayName(userId);
    const bodyText = String(req.body.body).trim();

    const { data, error } = await supabase
      .from('chat_messages')
      .insert({
        user_id: userId,
        display_name: displayName,
        body: bodyText
      })
      .select('id, user_id, display_name, body, created_at')
      .single();

    if (error) {
      logger.error('chat insert message', error);
      return res.status(500).json({ message: 'Could not send message' });
    }

    res.status(201).json({
      message: {
        id: data.id,
        userId: data.user_id,
        displayName: data.display_name,
        body: data.body,
        createdAt: data.created_at,
        reactions: []
      }
    });
  }
);

router.post(
  '/reactions/toggle',
  auth,
  reactionLimiter,
  [
    body('messageId').isUUID().withMessage('messageId must be a UUID'),
    body('emoji').isString().trim().isLength({ min: 1, max: 16 })
  ],
  async (req, res) => {
    if (!isChatConfigured()) return chat503(res);
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: errors.array()[0]?.msg || 'Invalid body' });
    }

    const emoji = String(req.body.emoji).trim();
    if (!ALLOWED_REACTIONS.has(emoji)) {
      return res.status(400).json({ message: 'Reaction not allowed' });
    }

    const supabase = getAdminClient();
    const userId = req.user.id;
    const messageId = req.body.messageId;

    const { data: existing } = await supabase
      .from('chat_reactions')
      .select('id')
      .eq('message_id', messageId)
      .eq('user_id', userId)
      .eq('emoji', emoji)
      .maybeSingle();

    if (existing?.id) {
      const { error: delErr } = await supabase.from('chat_reactions').delete().eq('id', existing.id);
      if (delErr) {
        logger.error('chat reaction delete', delErr);
        return res.status(500).json({ message: 'Could not update reaction' });
      }
      return res.json({ toggled: 'off', messageId, emoji, userId });
    }

    const { error: insErr } = await supabase.from('chat_reactions').insert({
      message_id: messageId,
      user_id: userId,
      emoji
    });

    if (insErr) {
      if (insErr.code === '23503') {
        return res.status(404).json({ message: 'Message not found' });
      }
      logger.error('chat reaction insert', insErr);
      return res.status(500).json({ message: 'Could not update reaction' });
    }

    res.json({ toggled: 'on', messageId, emoji, userId });
  }
);

module.exports = router;
