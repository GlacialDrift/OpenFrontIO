import { PathFindResultType } from "../pathfinding/AStar";
import { MiniAStar } from "../pathfinding/MiniAStar";
import { Game, Player, UnitType } from "./Game";
import { andFN, GameMap, manhattanDistFN, TileRef } from "./GameMap";

export function canBuildTransportShip(
  game: Game,
  player: Player,
  tile: TileRef,
): TileRef | false {
  if (
    player.unitCount(UnitType.TransportShip) >= game.config().boatMaxNumber()
  ) {
    return false;
  }

  const dst = targetTransportTile(game, tile);
  if (dst === null) {
    return false;
  }

  const other = game.owner(tile);
  if (other === player) {
    return false;
  }
  if (other.isPlayer() && player.isFriendly(other)) {
    return false;
  }

  if (game.isOceanShore(dst)) {
    let myPlayerBordersOcean = false;
    for (const bt of player.borderTiles()) {
      if (game.isOceanShore(bt)) {
        myPlayerBordersOcean = true;
        break;
      }
    }

    let otherPlayerBordersOcean = false;
    if (!game.hasOwner(tile)) {
      otherPlayerBordersOcean = true;
    } else {
      for (const bt of (other as Player).borderTiles()) {
        if (game.isOceanShore(bt)) {
          otherPlayerBordersOcean = true;
          break;
        }
      }
    }

    if (myPlayerBordersOcean && otherPlayerBordersOcean) {
      return transportShipSpawn(game, player, dst);
    } else {
      return false;
    }
  }

  // Now we are boating in a lake, so do a bfs from target until we find
  // a border tile owned by the player

  const tiles = game.bfs(
    dst,
    andFN(
      manhattanDistFN(dst, 300),
      (_, t: TileRef) => game.isLake(t) || game.isShore(t),
    ),
  );

  const sorted = Array.from(tiles).sort(
    (a, b) => game.manhattanDist(dst, a) - game.manhattanDist(dst, b),
  );

  for (const t of sorted) {
    if (game.owner(t) === player) {
      return transportShipSpawn(game, player, t);
    }
  }
  return false;
}

function transportShipSpawn(
  game: Game,
  player: Player,
  targetTile: TileRef,
): TileRef | false {
  if (!game.isShore(targetTile)) {
    return false;
  }
  const spawn = closestShoreFromPlayer(game, player, targetTile);
  if (spawn === null) {
    return false;
  }
  return spawn;
}

export function sourceDstOceanShore(
  gm: Game,
  src: Player,
  tile: TileRef,
): [TileRef | null, TileRef | null] {
  const dst = gm.owner(tile);
  const srcTile = closestShoreFromPlayer(gm, src, tile);
  let dstTile: TileRef | null = null;
  if (dst.isPlayer()) {
    dstTile = closestShoreFromPlayer(gm, dst as Player, tile);
  } else {
    dstTile = closestShoreTN(gm, tile, 50);
  }
  return [srcTile, dstTile];
}

export function targetTransportTile(gm: Game, tile: TileRef): TileRef | null {
  const dst = gm.playerBySmallID(gm.ownerID(tile));
  let dstTile: TileRef | null = null;
  if (dst.isPlayer()) {
    dstTile = closestShoreFromPlayer(gm, dst as Player, tile);
  } else {
    dstTile = closestShoreTN(gm, tile, 50);
  }
  return dstTile;
}

export function closestShoreFromPlayer(
  gm: GameMap,
  player: Player,
  target: TileRef,
): TileRef | null {
  const shoreTiles = Array.from(player.borderTiles()).filter((t) =>
    gm.isShore(t),
  );
  if (shoreTiles.length === 0) {
    return null;
  }

  return shoreTiles.reduce((closest, current) => {
    const closestDistance = gm.manhattanDist(target, closest);
    const currentDistance = gm.manhattanDist(target, current);
    return currentDistance < closestDistance ? current : closest;
  });
}

export function bestShoreDeploymentSource(
  gm: Game,
  player: Player,
  target: TileRef,
): TileRef | false {
  const t = targetTransportTile(gm, target);
  if (t === null) return false;

  const candidates = candidateShoreTiles(gm, player, t);
  if (candidates.length === 0) return false;

  const aStar = new MiniAStar(gm, gm.miniMap(), candidates, t, 1_000_000, 1);
  const result = aStar.compute();
  if (result !== PathFindResultType.Completed) {
    console.warn(`bestShoreDeploymentSource: path not found: ${result}`);
    return false;
  }
  const path = aStar.reconstructPath();
  if (path.length === 0) {
    return false;
  }
  const potential = path[0];
  // Since mini a* downscales the map, we need to check the neighbors
  // of the potential tile to find a valid deployment point
  const neighbors = gm
    .neighbors(potential)
    .filter((n) => gm.isShore(n) && gm.owner(n) === player);
  if (neighbors.length === 0) {
    return false;
  }
  return neighbors[0];
}

export function candidateShoreTiles(
  gm: Game,
  player: Player,
  target: TileRef,
): TileRef[] {
  let closestManhattanDistance = Infinity;
  let bestByManhattan: TileRef | null = null;

  const borderShoreTiles = Array.from(player.borderTiles()).filter((t) =>
    gm.isShore(t),
  );

  for (const tile of borderShoreTiles) {
    const distance = gm.manhattanDist(tile, target);

    // Manhattan-closest tile
    if (distance < closestManhattanDistance) {
      closestManhattanDistance = distance;
      bestByManhattan = tile;
    }
  }

  // BFS is more expensive than previous random sampling of tiles. However, only a single returned tile is evaluated in
  // `bestShoreDeploymentSource` instead of up to 50 tiles. In most cases (where the closest source is not far from the
  // target tile), the BFS can return the optimal source tile with only a few thousand tiles visited.
  // This compares to the A* algorithm for up to 50 tiles, where each A* is allowed up to 1_000_000 iterations
  const borderShoreSet: Set<TileRef> = new Set(borderShoreTiles);
  const bfsResult = reverseBFS(target, gm, borderShoreSet);

  // return the best source found and only return a single Tile. Guaranteed to return a Tile as no core logic of
  // `bestByManhattan` has changed. If there is at least 1 shore tile, then there is guaranteed to be a `bestByManhattan`.
  // The code already handled situations where no shore tiles existed, so no need to check for that here.
  return [bfsResult ?? bestByManhattan!];
}

// BFS from the target tile and return once a source tile has been found
function reverseBFS(
  target: TileRef,
  gm: GameMap,
  sources: Set<TileRef>,
): TileRef | null {
  const seen = new Set<TileRef>();
  const q: TileRef[] = [];

  for (const n of gm.neighbors(target)) {
    if (gm.isWater(n) || gm.isShore(n)) {
      seen.add(n);
      q.push(n);
    }
  }

  while (q.length > 0) {
    const size = q.length;
    for (let i = 0; i < size; i++) {
      const curr = q.shift();
      if (curr === undefined) continue;
      for (const n of gm.neighbors(curr)) {
        if (sources.has(n)) {
          return n;
        }
        if (!seen.has(n) && (gm.isWater(n) || gm.isShore(n))) {
          seen.add(n);
          q.push(n);
        }
      }
    }
  }

  console.warn("No source tile found in reverse BFS for Transport Ship");
  return null;
}

function closestShoreTN(
  gm: GameMap,
  tile: TileRef,
  searchDist: number,
): TileRef | null {
  const tn = Array.from(
    gm.bfs(
      tile,
      andFN((_, t) => !gm.hasOwner(t), manhattanDistFN(tile, searchDist)),
    ),
  )
    .filter((t) => gm.isShore(t))
    .sort((a, b) => gm.manhattanDist(tile, a) - gm.manhattanDist(tile, b));
  if (tn.length === 0) {
    return null;
  }
  return tn[0];
}
