// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CommentAuthorShape {
  id: string;
  name: string;
  photoUrl?: string;
}

interface ReactionShape {
  emoji: string;
  user?: CommentAuthorShape;
  createdAt?: Date;
}

interface CommentReplyShape {
  id: string;
  message: string;
  author?: CommentAuthorShape;
  createdAt?: Date;
  editedAt?: Date | null;
  reactions?: ReadonlyArray<ReactionShape>;
}

interface CommentShape {
  id: string;
  message: string;
  author: CommentAuthorShape;
  createdAt: Date;
  editedAt: Date | null;
  resolved: boolean;
  resolvedAt: Date | null;
  reactions: ReadonlyArray<ReactionShape>;
  clientMeta?: unknown;
  replies?: ReadonlyArray<CommentReplyShape>;
}

interface FigmaWithComments {
  comments?: ReadonlyArray<CommentShape>;
  getCommentsAsync?: () => Promise<ReadonlyArray<CommentShape>>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toIso(date: Date | unknown | null | undefined): string | null {
  if (!date) return null;
  if (date instanceof Date) return date.toISOString();
  return String(date);
}

function mapReactions(reactions: ReadonlyArray<ReactionShape> | undefined): Record<string, unknown>[] {
  if (!reactions || reactions.length === 0) return [];
  return Array.from(reactions).map((r) => ({
    emoji: r.emoji,
    user: r.user ? { id: r.user.id, name: r.user.name } : null,
    createdAt: toIso(r.createdAt),
  }));
}

function mapClientMeta(meta: unknown): Record<string, unknown> | undefined {
  if (!meta || typeof meta !== "object") return undefined;
  const m = meta as { x?: unknown; y?: unknown; nodeId?: unknown; nodeOffset?: unknown };
  if (m.x !== undefined && m.y !== undefined) {
    return { type: "canvas", x: m.x, y: m.y };
  }
  if (m.nodeId !== undefined) {
    return { type: "frame", nodeId: m.nodeId, offset: m.nodeOffset };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function getComments(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const includeResolved = (params.includeResolved as boolean | undefined) ?? false;

  const figmaAny = figma as unknown as FigmaWithComments;

  // Probe which access method is available
  let allComments: CommentShape[] = [];
  let accessMethod = "none";

  if (Array.isArray(figmaAny.comments)) {
    allComments = Array.from(figmaAny.comments);
    accessMethod = "figma.comments";
  } else if (typeof figmaAny.getCommentsAsync === "function") {
    allComments = Array.from(await figmaAny.getCommentsAsync());
    accessMethod = "figma.getCommentsAsync()";
  }

  if (accessMethod === "none") {
    throw new Error(
      "Comments API is unavailable in this Figma plugin context. " +
        'Ensure the plugin manifest includes the "comments" permission and that you are running a Figma version that exposes the comments API.',
    );
  }

  const filtered = includeResolved ? allComments : allComments.filter((c) => !c.resolved);

  const comments = filtered.map((c) => {
    const entry: Record<string, unknown> = {
      id: c.id,
      message: c.message,
      author: { id: c.author.id, name: c.author.name },
      createdAt: toIso(c.createdAt),
      editedAt: toIso(c.editedAt),
      resolved: c.resolved,
      resolvedAt: toIso(c.resolvedAt),
    };

    const position = mapClientMeta(c.clientMeta);
    if (position) entry.position = position;

    const reactions = mapReactions(c.reactions);
    if (reactions.length > 0) entry.reactions = reactions;

    if (c.replies && c.replies.length > 0) {
      entry.replies = Array.from(c.replies).map((r) => ({
        id: r.id,
        message: r.message,
        author: r.author ? { id: r.author.id, name: r.author.name } : null,
        createdAt: toIso(r.createdAt),
        editedAt: toIso(r.editedAt),
        reactions: mapReactions(r.reactions),
      }));
    }

    return entry;
  });

  return {
    success: true,
    accessMethod,
    count: comments.length,
    totalComments: allComments.length,
    includeResolved,
    comments,
  };
}
