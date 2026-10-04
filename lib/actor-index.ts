import type { PublicThreadEvent } from "./public-thread-events.ts";

export type ActorThreadInput = {
  repo: string;
  number: number;
  events: PublicThreadEvent[];
};

export type PublicActorThread = {
  repo: string;
  number: number;
  href: string;
  lastSeenAt: string;
  eventCount: number;
  comments: number;
  reviews: number;
  reviewStates: string[];
};

export type PublicActorResource = {
  login: string;
  actorType: string | null;
  lastSeenAt: string;
  eventCount: number;
  comments: number;
  reviews: number;
  threadCount: number;
  repoCount: number;
  repos: string[];
  authorAssociations: Record<string, number>;
  threads: PublicActorThread[];
};

export type PublicActorIndexRow = Omit<PublicActorResource, "threads" | "repos" | "authorAssociations"> & {
  href: string;
};

function maxIso(a: string, b: string) {
  return b > a ? b : a;
}

function threadHref(repo: string, number: number) {
  const [owner, name] = repo.split("/");
  return `threads/${owner}/${name}/${number}.json`;
}

export function actorHref(login: string) {
  return `actors/${encodeURIComponent(login)}.json`;
}

export function buildActorIndex(inputs: readonly ActorThreadInput[]) {
  const actors = new Map<
    string,
    {
      login: string;
      actorType: string | null;
      lastSeenAt: string;
      eventCount: number;
      comments: number;
      reviews: number;
      associations: Map<string, number>;
      threads: Map<
        string,
        {
          repo: string;
          number: number;
          lastSeenAt: string;
          eventCount: number;
          comments: number;
          reviews: number;
          reviewStates: Set<string>;
        }
      >;
    }
  >();

  for (const input of inputs) {
    for (const event of input.events) {
      let actor = actors.get(event.actor);
      if (!actor) {
        actor = {
          login: event.actor,
          actorType: event.actorType,
          lastSeenAt: event.at,
          eventCount: 0,
          comments: 0,
          reviews: 0,
          associations: new Map(),
          threads: new Map(),
        };
        actors.set(event.actor, actor);
      }

      actor.actorType = event.actorType ?? actor.actorType;
      actor.lastSeenAt = maxIso(actor.lastSeenAt, event.at);
      actor.eventCount += 1;
      if (event.kind === "comment") actor.comments += 1;
      if (event.kind === "review") actor.reviews += 1;
      if (event.authorAssociation) {
        actor.associations.set(
          event.authorAssociation,
          (actor.associations.get(event.authorAssociation) ?? 0) + 1,
        );
      }

      const key = `${input.repo}#${input.number}`;
      let thread = actor.threads.get(key);
      if (!thread) {
        thread = {
          repo: input.repo,
          number: input.number,
          lastSeenAt: event.at,
          eventCount: 0,
          comments: 0,
          reviews: 0,
          reviewStates: new Set(),
        };
        actor.threads.set(key, thread);
      }
      thread.lastSeenAt = maxIso(thread.lastSeenAt, event.at);
      thread.eventCount += 1;
      if (event.kind === "comment") thread.comments += 1;
      if (event.kind === "review") thread.reviews += 1;
      if (event.reviewState) thread.reviewStates.add(event.reviewState);
    }
  }

  const resources = new Map<string, PublicActorResource>();
  const rows: PublicActorIndexRow[] = [];

  for (const actor of actors.values()) {
    const threads: PublicActorThread[] = [...actor.threads.values()]
      .map((thread) => ({
        repo: thread.repo,
        number: thread.number,
        href: threadHref(thread.repo, thread.number),
        lastSeenAt: thread.lastSeenAt,
        eventCount: thread.eventCount,
        comments: thread.comments,
        reviews: thread.reviews,
        reviewStates: [...thread.reviewStates].sort(),
      }))
      .sort(
        (a, b) =>
          b.lastSeenAt.localeCompare(a.lastSeenAt) ||
          a.repo.localeCompare(b.repo) ||
          a.number - b.number,
      );

    const repos = [...new Set(threads.map((thread) => thread.repo))].sort();
    const resource: PublicActorResource = {
      login: actor.login,
      actorType: actor.actorType,
      lastSeenAt: actor.lastSeenAt,
      eventCount: actor.eventCount,
      comments: actor.comments,
      reviews: actor.reviews,
      threadCount: threads.length,
      repoCount: repos.length,
      repos,
      authorAssociations: Object.fromEntries(
        [...actor.associations.entries()].sort(([a], [b]) => a.localeCompare(b)),
      ),
      threads,
    };
    resources.set(actor.login, resource);
    rows.push({
      login: actor.login,
      actorType: actor.actorType,
      lastSeenAt: actor.lastSeenAt,
      eventCount: actor.eventCount,
      comments: actor.comments,
      reviews: actor.reviews,
      threadCount: threads.length,
      repoCount: repos.length,
      href: actorHref(actor.login),
    });
  }

  rows.sort(
    (a, b) =>
      b.lastSeenAt.localeCompare(a.lastSeenAt) ||
      b.eventCount - a.eventCount ||
      a.login.localeCompare(b.login),
  );

  return { rows, resources };
}
