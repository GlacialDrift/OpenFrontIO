import { colord, Colord, extend } from "colord";
import labPlugin from "colord/plugins/lab";
import lchPlugin from "colord/plugins/lch";
import Color from "colorjs.io";
import { ColoredTeams, Team } from "../game/Game";
import { PseudoRandom } from "../PseudoRandom";
import { simpleHash } from "../Util";
import {
  blueTeamColors,
  botTeamColors,
  greenTeamColors,
  orangeTeamColors,
  purpleTeamColors,
  redTeamColors,
  tealTeamColors,
  yellowTeamColors,
} from "./Colors";
extend([lchPlugin]);
extend([labPlugin]);

export class ColorAllocator {
  private availableColors: Colord[];
  private fallbackColors: Colord[];
  private assigned = new Map<string, Colord>();
  private teamPlayerColors = new Map<string, Colord>();
  private sampleWOReplace: number;

  constructor(colors: Colord[], fallback: Colord[]) {
    this.availableColors = [...colors];
    this.fallbackColors = [...fallback];
    this.sampleWOReplace = 0;
  }

  private getTeamColorVariations(team: Team): Colord[] {
    switch (team) {
      case ColoredTeams.Blue:
        return blueTeamColors;
      case ColoredTeams.Red:
        return redTeamColors;
      case ColoredTeams.Teal:
        return tealTeamColors;
      case ColoredTeams.Purple:
        return purpleTeamColors;
      case ColoredTeams.Yellow:
        return yellowTeamColors;
      case ColoredTeams.Orange:
        return orangeTeamColors;
      case ColoredTeams.Green:
        return greenTeamColors;
      case ColoredTeams.Bot:
        return botTeamColors;
      case ColoredTeams.Humans:
        return blueTeamColors;
      case ColoredTeams.Nations:
        return redTeamColors;
      default:
        return [this.assignColor(team)];
    }
  }

  /*
   * Refactored to use random sampling without replacement. Assume an array of
   * length 10: [0,1,2,3,4,5,6,7,8,9]. We need to keep track of how many items
   * have been sampled (this.sampleWOReplace).
   *
   * Generate a random integer between 0 and (array.length - sampleWOReplace)
   * (= rand(0, 10-0)). Suppose 7 is the random integer result.
   *
   * the first sample becomes array[7] = 7. We then increment the number of items
   * that has been sampled (this.sampleWOReplace++ to become 1). We then swap the
   * items at the randomly selected position and the "end" of the array.
   *
   * For the "end" of the array we use array.length - sampleWOReplace (= 10-1 = 9).
   * The array becomes: [0,1,2,3,4,5,6,9,8,  7]. I've added a space in the array
   * to show where the "unused" and "used" items are. Left of the space are
   * "unused" items, right is "used" items
   *
   * Repeat the process. nextInt = rand(0, length-sampleWOReplace) = rand(0,9).
   * Suppose 3 is the next integer. Pull the value (3) for the result, increment
   * sampleWOReplace, swap the positions of the "end" of the array and the random result.
   *
   * The array becomes: [0,1,2,4,5,6,9,8,  3,7]. There are now 8 unusued, and two
   * used items in the array.
   *
   * When the entire array has been used (i.e. sampleWOReplace = array.length), reset.
   * In this case, set the array to be a copy of the fallback colors and reset the
   * value of sampleWOReplace to 0.
   */
  assignColor(id: string): Colord {
    if (this.assigned.has(id)) {
      return this.assigned.get(id)!;
    }

    if (this.sampleWOReplace === this.availableColors.length) {
      this.availableColors = [...this.fallbackColors];
      this.sampleWOReplace = 0;
    }

    const rand = new PseudoRandom(simpleHash(id));
    const randIndex = rand.nextInt(
      0,
      this.availableColors.length - this.sampleWOReplace,
    );

    const color = this.availableColors[randIndex];
    this.sampleWOReplace++;
    this.swap(
      this.availableColors,
      randIndex,
      this.availableColors.length - this.sampleWOReplace,
    );

    this.assigned.set(id, color);
    return color;
  }

  /**
   * Swap the positions of two elements in an array
   * @param array An array of any type
   * @param x Position of one of the elements to be swapped
   * @param y Position of other element to be swapped
   */
  swap<Type>(array: Type[], x: number, y: number) {
    if (x >= array.length || x < 0)
      throw new Error(
        `Index: ${x} out of bounds for array of length: ${array.length}`,
      );
    if (y >= array.length || y < 0)
      throw new Error(
        `Index: ${y} out of bounds for array of length: ${array.length}`,
      );
    const temp = array[x];
    array[x] = array[y];
    array[y] = temp;
  }

  assignTeamColor(team: Team): Colord {
    const teamColors = this.getTeamColorVariations(team);
    const rgb = teamColors[0].toRgb();
    rgb.r = Math.round(rgb.r);
    rgb.g = Math.round(rgb.g);
    rgb.b = Math.round(rgb.b);
    return colord(rgb);
  }

  assignTeamPlayerColor(team: Team, playerId: string): Colord {
    if (this.teamPlayerColors.has(playerId)) {
      return this.teamPlayerColors.get(playerId)!;
    }

    const teamColors = this.getTeamColorVariations(team);
    const hashValue = simpleHash(playerId);
    const colorIndex = hashValue % teamColors.length;
    const color = teamColors[colorIndex];

    this.teamPlayerColors.set(playerId, color);

    return color;
  }
}

// Select a distinct color index from the available colors that
// is most different from the assigned colors
export function selectDistinctColorIndex(
  availableColors: Colord[],
  assignedColors: Colord[],
): number | null {
  if (assignedColors.length === 0) {
    throw new Error("No assigned colors");
  }

  const assignedLabColors = assignedColors.map(toColor);

  let maxDeltaE = 0;
  let maxIndex = 0;

  for (let i = 0; i < availableColors.length; i++) {
    const color = availableColors[i];
    const deltaE = minDeltaE(toColor(color), assignedLabColors);
    if (deltaE > maxDeltaE) {
      maxDeltaE = deltaE;
      maxIndex = i;
    }
  }
  return maxIndex;
}

function minDeltaE(lab1: Color, assignedLabColors: Color[]) {
  return assignedLabColors.reduce((min, assigned) => {
    return Math.min(min, deltaE2000(lab1, assigned));
  }, Infinity);
}

function deltaE2000(c1: Color, c2: Color): number {
  return c1.deltaE(c2, "2000");
}

function toColor(colord: Colord): Color {
  const lab = colord.toLab();
  return new Color("lab", [lab.l, lab.a, lab.b]);
}
