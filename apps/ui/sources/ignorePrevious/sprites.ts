// Copyright (c) 2026 ruddy-dev, MIT
// Pixel grids ported from mockup-12/sprites/sprites.js, round 8.
// Fully expanded 16 × 16 grids include state eyes and IPB headphones.
// No drawing code. Dots are transparent; O/L use spriteStateTokens; other
// letters use spriteColours with robotPaintMap overrides from palette.ts.
import type { Bulb } from './model/bulb';

export type SpriteDetail = 'S' | 'M' | 'L';
export type SpriteGrid = readonly string[];

const ragdoll_turn_S: SpriteGrid = [
    "................",
    ".OO..........OO.",
    ".OpO........OpO.",
    ".OppOOOOOOOOppO.",
    "OffpffffffffpffO",
    "OffffffmmffffffO",
    "OffffmmmmmmffffO",
    "OfmeemmmmmmeemfO",
    "OfmeemmmmmmeemfO",
    "OfmmmmmmmmmmmmfO",
    "OfffmmmnnmmmfffO",
    "OffffwwwwwwffffO",
    ".OffwwwwwwwwffO.",
    "..OOwwwwwwwwOO..",
    "....OOOOOOOO....",
    "................",
];

const ragdoll_turn_L: SpriteGrid = [
    "................",
    ".OO..........OO.",
    ".OpO........OpO.",
    ".OppOOOOOOOOppO.",
    "OffpffffffffpffO",
    "OffffffmmffffffO",
    "OffffmmmmmmffffO",
    "Ofm*emmmmmm*emfO",
    "OfmeemmmmmmeemfO",
    "OfmmmmmmmmmmmmfO",
    "OfffmmmnnmmmfffO",
    "OffffwwwwwwffffO",
    ".OffwwwwwwwwffO.",
    "..OOwwwwwwwwOO..",
    "....OOOOOOOO....",
    "................",
];

const ragdoll_stuck_S: SpriteGrid = [
    "................",
    ".OO..........OO.",
    ".OpO........OpO.",
    ".OppOOOOOOOOppO.",
    "OffpffffffffpffO",
    "OffffffmmffffffO",
    "OfxfxmmmmmmxfxfO",
    "OfmxmmmmmmmmxmfO",
    "OfxmxmmmmmmxmxfO",
    "OfmmmmmmmmmmmmfO",
    "OfffmmmnnmmmfffO",
    "OffffwwwwwwffffO",
    ".OffwwwwwwwwffO.",
    "..OOwwwwwwwwOO..",
    "....OOOOOOOO....",
    "................",
];

const ragdoll_working_S: SpriteGrid = [
    "................",
    ".OO..........OO.",
    ".OpO........OpO.",
    ".OppOOOOOOOOppO.",
    "OffpffffffffpffO",
    "OffffffmmffffffO",
    "OffffmmmmmmffffO",
    "OflllmmmmmmlllfO",
    "OfmeemmmmmmeemfO",
    "OfmmmmmmmmmmmmfO",
    "OfffmmmnnmmmfffO",
    "OffffwwwwwwffffO",
    ".OffwwwwwwwwffO.",
    "..OOwwwwwwwwOO..",
    "....OOOOOOOO....",
    "................",
];

const ragdoll_idle_S: SpriteGrid = [
    "................",
    ".OO..........OO.",
    ".OpO........OpO.",
    ".OppOOOOOOOOppO.",
    "OffpffffffffpffO",
    "OffffffmmffffffO",
    "OffffmmmmmmffffO",
    "OflllmmmmmmlllfO",
    "OfmeemmmmmmeemfO",
    "OfmmmmmmmmmmmmfO",
    "OfffmmmnnmmmfffO",
    "OffffwwwwwwffffO",
    ".OffwwwwwwwwffO.",
    "..OOwwwwwwwwOO..",
    "....OOOOOOOO....",
    "................",
];

const ginger_turn_S: SpriteGrid = [
    "................",
    ".OO..........OO.",
    ".OpO........OpO.",
    ".OppOOOOOOOOppO.",
    "OffpfsfssfsfpffO",
    "OffffffssffffffO",
    "OffffffffffffffO",
    "OffeeffffffeeffO",
    "OffeeffffffeeffO",
    "OsffffffffffffsO",
    "OfffffwnnwfffffO",
    "OsfffwwwwwwfffsO",
    ".OffwwwwwwwwffO.",
    "..OOwwwwwwwwOO..",
    "....OOOOOOOO....",
    "................",
];

const ginger_turn_L: SpriteGrid = [
    "................",
    ".OO..........OO.",
    ".OpO........OpO.",
    ".OppOOOOOOOOppO.",
    "OffpfsfssfsfpffO",
    "OffffffssffffffO",
    "OffffffffffffffO",
    "Off*effffff*effO",
    "OffeeffffffeeffO",
    "OsffffffffffffsO",
    "OfffffwnnwfffffO",
    "OsfffwwwwwwfffsO",
    ".OffwwwwwwwwffO.",
    "..OOwwwwwwwwOO..",
    "....OOOOOOOO....",
    "................",
];

const ginger_stuck_S: SpriteGrid = [
    "................",
    ".OO..........OO.",
    ".OpO........OpO.",
    ".OppOOOOOOOOppO.",
    "OffpfsfssfsfpffO",
    "OffffffssffffffO",
    "OfxfxffffffxfxfO",
    "OffxffffffffxffO",
    "OfxfxffffffxfxfO",
    "OsffffffffffffsO",
    "OfffffwnnwfffffO",
    "OsfffwwwwwwfffsO",
    ".OffwwwwwwwwffO.",
    "..OOwwwwwwwwOO..",
    "....OOOOOOOO....",
    "................",
];

const ginger_working_S: SpriteGrid = [
    "................",
    ".OO..........OO.",
    ".OpO........OpO.",
    ".OppOOOOOOOOppO.",
    "OffpfsfssfsfpffO",
    "OffffffssffffffO",
    "OffffffffffffffO",
    "OflllfffffflllfO",
    "OffeeffffffeeffO",
    "OsffffffffffffsO",
    "OfffffwnnwfffffO",
    "OsfffwwwwwwfffsO",
    ".OffwwwwwwwwffO.",
    "..OOwwwwwwwwOO..",
    "....OOOOOOOO....",
    "................",
];

const ginger_idle_S: SpriteGrid = [
    "................",
    ".OO..........OO.",
    ".OpO........OpO.",
    ".OppOOOOOOOOppO.",
    "OffpfsfssfsfpffO",
    "OffffffssffffffO",
    "OffffffffffffffO",
    "OflllfffffflllfO",
    "OffeeffffffeeffO",
    "OsffffffffffffsO",
    "OfffffwnnwfffffO",
    "OsfffwwwwwwfffsO",
    ".OffwwwwwwwwffO.",
    "..OOwwwwwwwwOO..",
    "....OOOOOOOO....",
    "................",
];

const tuxedo_turn_S: SpriteGrid = [
    "................",
    ".OO..........OO.",
    ".OpO........OpO.",
    ".OppOOOOOOOOppO.",
    "OffpfffwwfffpffO",
    "OffffffwwffffffO",
    "OffffffwwffffffO",
    "OffeeffwwffeeffO",
    "OffeefwwwwfeeffO",
    "OfffffwwwwfffffO",
    "OfffffwnnwfffffO",
    "OffffwwwwwwffffO",
    ".OffwwwwwwwwffO.",
    "..OOwwwwwwwwOO..",
    "....OOOOOOOO....",
    "................",
];

const tuxedo_turn_L: SpriteGrid = [
    "................",
    ".OO..........OO.",
    ".OpO........OpO.",
    ".OppOOOOOOOOppO.",
    "OffpfffwwfffpffO",
    "OffffffwwffffffO",
    "OffffffwwffffffO",
    "Off*effwwff*effO",
    "OffeefwwwwfeeffO",
    "OfffffwwwwfffffO",
    "OfffffwnnwfffffO",
    "OffffwwwwwwffffO",
    ".OffwwwwwwwwffO.",
    "..OOwwwwwwwwOO..",
    "....OOOOOOOO....",
    "................",
];

const tuxedo_stuck_S: SpriteGrid = [
    "................",
    ".OO..........OO.",
    ".OpO........OpO.",
    ".OppOOOOOOOOppO.",
    "OffpfffwwfffpffO",
    "OffffffwwffffffO",
    "OfxfxffwwffxfxfO",
    "OffxfffwwfffxffO",
    "OfxfxfwwwwfxfxfO",
    "OfffffwwwwfffffO",
    "OfffffwnnwfffffO",
    "OffffwwwwwwffffO",
    ".OffwwwwwwwwffO.",
    "..OOwwwwwwwwOO..",
    "....OOOOOOOO....",
    "................",
];

const tuxedo_working_S: SpriteGrid = [
    "................",
    ".OO..........OO.",
    ".OpO........OpO.",
    ".OppOOOOOOOOppO.",
    "OffpfffwwfffpffO",
    "OffffffwwffffffO",
    "OffffffwwffffffO",
    "OflllffwwfflllfO",
    "OffeefwwwwfeeffO",
    "OfffffwwwwfffffO",
    "OfffffwnnwfffffO",
    "OffffwwwwwwffffO",
    ".OffwwwwwwwwffO.",
    "..OOwwwwwwwwOO..",
    "....OOOOOOOO....",
    "................",
];

const tuxedo_idle_S: SpriteGrid = [
    "................",
    ".OO..........OO.",
    ".OpO........OpO.",
    ".OppOOOOOOOOppO.",
    "OffpfffwwfffpffO",
    "OffffffwwffffffO",
    "OffffffwwffffffO",
    "OflllffwwfflllfO",
    "OffeefwwwwfeeffO",
    "OfffffwwwwfffffO",
    "OfffffwnnwfffffO",
    "OffffwwwwwwffffO",
    ".OffwwwwwwwwffO.",
    "..OOwwwwwwwwOO..",
    "....OOOOOOOO....",
    "................",
];

const fox_turn_S: SpriteGrid = [
    "O..............O",
    "OO............OO",
    "OkO..........OkO",
    "OkpO........OpkO",
    "OkppOOOOOOOOppkO",
    "OffffffffffffffO",
    "OffffffffffffffO",
    "OffeeffffffeeffO",
    "OffeeffffffeeffO",
    "OwwffffffffffwwO",
    ".OwwwffwwffwwwO.",
    "..OwwwwwwwwwwO..",
    "...OwwwwwwwwO...",
    "....OwwnnwwO....",
    ".....OOOOOO.....",
    "................",
];

const fox_turn_L: SpriteGrid = [
    "O..............O",
    "OO............OO",
    "OkO..........OkO",
    "OkpO........OpkO",
    "OkppOOOOOOOOppkO",
    "OffffffffffffffO",
    "OffffffffffffffO",
    "Off*effffff*effO",
    "OffeeffffffeeffO",
    "OwwffffffffffwwO",
    ".OwwwffwwffwwwO.",
    "..OwwwwwwwwwwO..",
    "...OwwwwwwwwO...",
    "....OwwnnwwO....",
    ".....OOOOOO.....",
    "................",
];

const fox_stuck_S: SpriteGrid = [
    "O..............O",
    "OO............OO",
    "OkO..........OkO",
    "OkpO........OpkO",
    "OkppOOOOOOOOppkO",
    "OffffffffffffffO",
    "OfxfxffffffxfxfO",
    "OffxffffffffxffO",
    "OfxfxffffffxfxfO",
    "OwwffffffffffwwO",
    ".OwwwffwwffwwwO.",
    "..OwwwwwwwwwwO..",
    "...OwwwwwwwwO...",
    "....OwwnnwwO....",
    ".....OOOOOO.....",
    "................",
];

const fox_working_S: SpriteGrid = [
    "O..............O",
    "OO............OO",
    "OkO..........OkO",
    "OkpO........OpkO",
    "OkppOOOOOOOOppkO",
    "OffffffffffffffO",
    "OffffffffffffffO",
    "OflllfffffflllfO",
    "OffeeffffffeeffO",
    "OwwffffffffffwwO",
    ".OwwwffwwffwwwO.",
    "..OwwwwwwwwwwO..",
    "...OwwwwwwwwO...",
    "....OwwnnwwO....",
    ".....OOOOOO.....",
    "................",
];

const fox_idle_S: SpriteGrid = [
    "O..............O",
    "OO............OO",
    "OkO..........OkO",
    "OkpO........OpkO",
    "OkppOOOOOOOOppkO",
    "OffffffffffffffO",
    "OffffffffffffffO",
    "OflllfffffflllfO",
    "OffeeffffffeeffO",
    "OwwffffffffffwwO",
    ".OwwwffwwffwwwO.",
    "..OwwwwwwwwwwO..",
    "...OwwwwwwwwO...",
    "....OwwnnwwO....",
    ".....OOOOOO.....",
    "................",
];

const ipdroid_turn_S: SpriteGrid = [
    "..........LL....",
    ".........O......",
    ".....OOOOOO.....",
    "....OkkkkkkO....",
    "...OkhYYYYYkO...",
    "..OkYhkkkkYykO..",
    ".OkYYkweeekYykO.",
    ".OkYYkeLLekYykO.",
    ".OkYYkeLLekYykO.",
    ".OkYYkeeeekYykO.",
    ".OkYYYkkkkYyykO.",
    ".OkYYYYYYYyyykO.",
    "..OkYYYYYyyykO..",
    "...OOOOOOOOOO...",
    "....OyyO.OyyO...",
    "....OOOO.OOOO...",
];

const ipdroid_stuck_S: SpriteGrid = [
    "..........LL....",
    ".........O......",
    ".....OOOOOO.....",
    "....OkkkkkkO....",
    "...OkhYYYYYkO...",
    "..OkYhkkkkYykO..",
    ".OkYYkLeeLkYykO.",
    ".OkYYkeLLekYykO.",
    ".OkYYkeLLekYykO.",
    ".OkYYkLeeLkYykO.",
    ".OkYYYkkkkYyykO.",
    ".OkYYYYYYYyyykO.",
    "..OkYYYYYyyykO..",
    "...OOOOOOOOOO...",
    "....OyyO.OyyO...",
    "....OOOO.OOOO...",
];

const ipdroid_working_S: SpriteGrid = [
    "..........LL....",
    ".........O......",
    ".....OOOOOO.....",
    "....OkkkkkkO....",
    "...OkhYYYYYkO...",
    "..OkYhkkkkYykO..",
    ".OkYYkweeekYykO.",
    ".OkYYkeeeekYykO.",
    ".OkYYkLLLLkYykO.",
    ".OkYYkeeeekYykO.",
    ".OkYYYkkkkYyykO.",
    ".OkYYYYYYYyyykO.",
    "..OkYYYYYyyykO..",
    "...OOOOOOOOOO...",
    "....OyyO.OyyO...",
    "....OOOO.OOOO...",
];

const ipdroid_idle_S: SpriteGrid = [
    "..........LL....",
    ".........O......",
    ".....OOOOOO.....",
    "....OkkkkkkO....",
    "...OkhYYYYYkO...",
    "..OkYhkkkkYykO..",
    ".OkYYkeeeekYykO.",
    ".OkYYkeeeekYykO.",
    ".OkYYkeeeekYykO.",
    ".OkYYkeLLekYykO.",
    ".OkYYYkkkkYyykO.",
    ".OkYYYYYYYyyykO.",
    "..OkYYYYYyyykO..",
    "...OOOOOOOOOO...",
    "....OyyO.OyyO...",
    "....OOOO.OOOO...",
];

const ipb_turn_S: SpriteGrid = [
    ".......LL.......",
    "......LLLL......",
    ".......OO.......",
    "...OOOOOOOOOO...",
    "..OKKkkkkkkkkO..",
    "..OKkkkwwkkkkO..",
    "..OkwkkwwkkwkO..",
    "..OkwwwwwwwwkO..",
    "..OkwwwkkwwvkO..",
    "..OkkvvvvvvkkO..",
    "..OkkkkkkkkkkO..",
    "...OOOOOOOOOO...",
    "......OkkO......",
    "....OKKkkkkO....",
    "....OKkkkkkO....",
    "....OOOOOOOO....",
];

const ipb_stuck_S: SpriteGrid = [
    ".......LL.......",
    "......LLLL......",
    ".......OO.......",
    "...OOOOOOOOOO...",
    "..OKKkkkkkkkkO..",
    "..OKkwwwwwwkkO..",
    "..OkkwkwwkwkkO..",
    "..OkwkwwwwkwkO..",
    "..OkkwkwwkwkkO..",
    "..OkkvvvvvvkkO..",
    "..OkkkkkkkkkkO..",
    "...OOOOOOOOOO...",
    "......OkkO......",
    "....OKKkkkkO....",
    "....OKkkkkkO....",
    "....OOOOOOOO....",
];

const ipb_working_S: SpriteGrid = [
    ".......LL.......",
    "..OOOOOLLOOOOO..",
    ".OCCCCCCCCCCCCO.",
    ".OCOOOOOOOOOOCO.",
    ".OCKKkkkkkkkkCO.",
    "OcDKkwwwwwwkkDCO",
    "OCDkwwwwwwwwkDCO",
    "OCDkkkkwwkkkkDCO",
    "OCDkwkwwwwkvkDCO",
    "OCDkkvvvvvvkkDCO",
    ".OOkkkkkkkkkkOO.",
    "...OOOOOOOOOO...",
    "......OkkO......",
    "....OKKkkkkO....",
    "....OKkkkkkO....",
    "....OOOOOOOO....",
];

const ipb_idle_S: SpriteGrid = [
    ".......LL.......",
    "......LLLL......",
    ".......OO.......",
    "...OOOOOOOOOO...",
    "..OKKkkkkkkkkO..",
    "..OKkwwwwwwkkO..",
    "..OkwwwwwwwwkO..",
    "..OkwwwwwwwwkO..",
    "..OkwkkwwkkvkO..",
    "..OkkvvvvvvkkO..",
    "..OkkkkkkkkkkO..",
    ".OOOOOOOOOOOOOO.",
    ".OcDCCCCCCCCDCO.",
    ".OCDOKKkkkkODCO.",
    ".OOOOKkkkkkOOOO.",
    "....OOOOOOOO....",
];

const cxprompt_turn_S: SpriteGrid = [
    "................",
    "..OOOOOOOOOOOO..",
    "..OhpphhhhhhgO..",
    "..OhggggggggsO..",
    "OOOGGGGGGGGGGOOO",
    "OhOGLLGGGGGGGOsO",
    "OgOGGLLGGLLGGOsO",
    "OOOGLLGGGLLGGOOO",
    "..OgGGGGGGGGsO..",
    "..OOOOOOOOOOOO..",
    "......OgsO......",
    "....OhgggggO....",
    "....OggLLgsO....",
    "....OgggsssO....",
    "....OOOOOOOO....",
    "....OOO..OOO....",
];

const cxprompt_stuck_S: SpriteGrid = [
    "................",
    "..OOOOOOOOOOOO..",
    "..OhpphhhhhhgO..",
    "..OhggggggggsO..",
    "OOOGGGGGGGGGGOOO",
    "OhOGLGLGLGLGGOsO",
    "OgOGGLGGGLGGGOsO",
    "OOOGLGLGLGLGGOOO",
    "..OgGGGGGGGGsO..",
    "..OOOOOOOOOOOO..",
    "......OgsO......",
    "....OhgggggO....",
    "....OggLLgsO....",
    "....OgggsssO....",
    "....OOOOOOOO....",
    "....OOO..OOO....",
];

const cxprompt_working_S: SpriteGrid = [
    "................",
    "..OOOOOOOOOOOO..",
    "..OhpphhhhhhgO..",
    "..OhggggggggsO..",
    "OOOGGGGGGGGGGOOO",
    "OhOGLLGGGGGGGOsO",
    "OgOGGLLGGGGGGOsO",
    "OOOGLLGGLLLGGOOO",
    "..OgGGGGGGGGsO..",
    "..OOOOOOOOOOOO..",
    "......OgsO......",
    "....OhgggggO....",
    "....OggLLgsO....",
    "....OgggsssO....",
    "....OOOOOOOO....",
    "....OOO..OOO....",
];

const cxprompt_idle_S: SpriteGrid = [
    "................",
    "..OOOOOOOOOOOO..",
    "..OhpphhhhhhgO..",
    "..OhggggggggsO..",
    "OOOGGGGGGGGGGOOO",
    "OhOGGGGGGGGGGOsO",
    "OgOGGGGGGGGGGOsO",
    "OOOGGGGGLLLGGOOO",
    "..OgGGGGGGGGsO..",
    "..OOOOOOOOOOOO..",
    "......OgsO......",
    "....OhgggggO....",
    "....OggLLgsO....",
    "....OgggsssO....",
    "....OOOOOOOO....",
    "....OOO..OOO....",
];

const cxloupe_turn_S: SpriteGrid = [
    "................",
    "................",
    "...OOOOOOOO.....",
    "..OhhVVVVVOOOOO.",
    ".OhVVVVVVOrrrrrO",
    ".OVVVVVVVOrGLGrO",
    ".OVLLGVVVOrLLLrO",
    ".OVLLGVVVOrGLGrO",
    ".OVGGGVVVOrrrrrO",
    ".OVVVVVVVsOOOOO.",
    ".OVVVVVVVVVVsO..",
    "..OOOOOOOOOOO...",
    "......OVsO......",
    "....OhVVVssO....",
    "....OVVVsssO....",
    "....OOOOOOOO....",
];

const cxloupe_stuck_S: SpriteGrid = [
    "................",
    "................",
    "...OOOOOOOO.....",
    "..OhhVVVVVOOOOO.",
    ".OhVVVVVVOrrrrrO",
    ".OVVVVVVVOrLGLrO",
    ".OVLGLVVVOrGLGrO",
    ".OVGLGVVVOrLGLrO",
    ".OVLGLVVVOrrrrrO",
    ".OVVVVVVVsOOOOO.",
    ".OVVVVVVVVVVsO..",
    "..OOOOOOOOOOO...",
    "......OVsO......",
    "....OhVVVssO....",
    "....OVVVsssO....",
    "....OOOOOOOO....",
];

const cxloupe_working_S: SpriteGrid = [
    "................",
    "................",
    "...OOOOOOOO.....",
    "..OhhVVVVVOOOOO.",
    ".OhVVVVVVOrrrrrO",
    ".OVVVVVVVOrGGGrO",
    ".OVGGGVVVOrLLLrO",
    ".OVLLLVVVOrGGGrO",
    ".OVGGGVVVOrrrrrO",
    ".OVVVVVVVsOOOOO.",
    ".OVVVVVVVVVVsO..",
    "..OOOOOOOOOOO...",
    "......OVsO......",
    "....OhVVVssO....",
    "....OVVVsssO....",
    "....OOOOOOOO....",
];

const cxloupe_idle_S: SpriteGrid = [
    "................",
    "................",
    "...OOOOOOOO.....",
    "..OhhVVVVVOOOOO.",
    ".OhVVVVVVOrrrrrO",
    ".OVVVVVVVOrGGGrO",
    ".OVGGGVVVOrGGGrO",
    ".OVGGGVVVOrLLGrO",
    ".OVLLGVVVOrrrrrO",
    ".OVVVVVVVsOOOOO.",
    ".OVVVVVVVVVVsO..",
    "..OOOOOOOOOOO...",
    "......OVsO......",
    "....OhVVVssO....",
    "....OVVVsssO....",
    "....OOOOOOOO....",
];

const cxlab_turn_S: SpriteGrid = [
    "................",
    "................",
    "....OOOOOOOO....",
    "...OhhVVVVVVO...",
    "..OhVVVVVVVVsO..",
    ".OVrrrrrrrrrrsO.",
    "OGrgLLggwLLggrGO",
    "OGrgLLgwgLLggrGO",
    ".OrggggggggggrO.",
    ".OVrrrrrrrrrrsO.",
    ".OVVVVVVVVVVssO.",
    "..OOOOOOOOOOOO..",
    "......OVsO......",
    "....OwwVVwwO....",
    "....OwwVVwwO....",
    "....OOOOOOOO....",
];

const cxlab_stuck_S: SpriteGrid = [
    "................",
    "................",
    "....OOOOOOOO....",
    "...OhhVVVVVVO...",
    "..OhVVVVVVVVsO..",
    ".OVrrrrrrrrrrsO.",
    "OGrgLgLgwLgLgrGO",
    "OGrggLgwggLggrGO",
    ".OrgLgLggLgLgrO.",
    ".OVrrrrrrrrrrsO.",
    ".OVVVVVVVVVVssO.",
    "..OOOOOOOOOOOO..",
    "......OVsO......",
    "....OwwVVwwO....",
    "....OwwVVwwO....",
    "....OOOOOOOO....",
];

const cxlab_working_S: SpriteGrid = [
    "................",
    "................",
    "....OOOOOOOO....",
    "...OhhVVVVVVO...",
    "..OhVVVVVVVVsO..",
    ".OVrrrrrrrrrrsO.",
    "OGrgggggwggggrGO",
    "OGrgLLLwgLLLgrGO",
    ".OrggggggggggrO.",
    ".OVrrrrrrrrrrsO.",
    ".OVVVVVVVVVVssO.",
    "..OOOOOOOOOOOO..",
    "......OVsO......",
    "....OwwVVwwO....",
    "....OwwVVwwO....",
    "....OOOOOOOO....",
];

const cxlab_idle_S: SpriteGrid = [
    "................",
    "................",
    "....OOOOOOOO....",
    "...OhhVVVVVVO...",
    "..OhVVVVVVVVsO..",
    ".OVrrrrrrrrrrsO.",
    "OGrgggggwggggrGO",
    "OGrggggwgggggrGO",
    ".OrgLLgggLLggrO.",
    ".OVrrrrrrrrrrsO.",
    ".OVVVVVVVVVVssO.",
    "..OOOOOOOOOOOO..",
    "......OVsO......",
    "....OwwVVwwO....",
    "....OwwVVwwO....",
    "....OOOOOOOO....",
];

export const spriteGrids = {
    ragdoll: {
        turn: { S: ragdoll_turn_S, M: ragdoll_turn_S, L: ragdoll_turn_L },
        stuck: { S: ragdoll_stuck_S, M: ragdoll_stuck_S, L: ragdoll_stuck_S },
        working: { S: ragdoll_working_S, M: ragdoll_working_S, L: ragdoll_working_S },
        waiting: { S: ragdoll_working_S, M: ragdoll_working_S, L: ragdoll_working_S },
        idle: { S: ragdoll_idle_S, M: ragdoll_idle_S, L: ragdoll_idle_S },
    },
    ginger: {
        turn: { S: ginger_turn_S, M: ginger_turn_S, L: ginger_turn_L },
        stuck: { S: ginger_stuck_S, M: ginger_stuck_S, L: ginger_stuck_S },
        working: { S: ginger_working_S, M: ginger_working_S, L: ginger_working_S },
        waiting: { S: ginger_working_S, M: ginger_working_S, L: ginger_working_S },
        idle: { S: ginger_idle_S, M: ginger_idle_S, L: ginger_idle_S },
    },
    tuxedo: {
        turn: { S: tuxedo_turn_S, M: tuxedo_turn_S, L: tuxedo_turn_L },
        stuck: { S: tuxedo_stuck_S, M: tuxedo_stuck_S, L: tuxedo_stuck_S },
        working: { S: tuxedo_working_S, M: tuxedo_working_S, L: tuxedo_working_S },
        waiting: { S: tuxedo_working_S, M: tuxedo_working_S, L: tuxedo_working_S },
        idle: { S: tuxedo_idle_S, M: tuxedo_idle_S, L: tuxedo_idle_S },
    },
    fox: {
        turn: { S: fox_turn_S, M: fox_turn_S, L: fox_turn_L },
        stuck: { S: fox_stuck_S, M: fox_stuck_S, L: fox_stuck_S },
        working: { S: fox_working_S, M: fox_working_S, L: fox_working_S },
        waiting: { S: fox_working_S, M: fox_working_S, L: fox_working_S },
        idle: { S: fox_idle_S, M: fox_idle_S, L: fox_idle_S },
    },
    ipdroid: {
        turn: { S: ipdroid_turn_S, M: ipdroid_turn_S, L: ipdroid_turn_S },
        stuck: { S: ipdroid_stuck_S, M: ipdroid_stuck_S, L: ipdroid_stuck_S },
        working: { S: ipdroid_working_S, M: ipdroid_working_S, L: ipdroid_working_S },
        waiting: { S: ipdroid_working_S, M: ipdroid_working_S, L: ipdroid_working_S },
        idle: { S: ipdroid_idle_S, M: ipdroid_idle_S, L: ipdroid_idle_S },
    },
    ipb: {
        turn: { S: ipb_turn_S, M: ipb_turn_S, L: ipb_turn_S },
        stuck: { S: ipb_stuck_S, M: ipb_stuck_S, L: ipb_stuck_S },
        working: { S: ipb_working_S, M: ipb_working_S, L: ipb_working_S },
        waiting: { S: ipb_working_S, M: ipb_working_S, L: ipb_working_S },
        idle: { S: ipb_idle_S, M: ipb_idle_S, L: ipb_idle_S },
    },
    cxprompt: {
        turn: { S: cxprompt_turn_S, M: cxprompt_turn_S, L: cxprompt_turn_S },
        stuck: { S: cxprompt_stuck_S, M: cxprompt_stuck_S, L: cxprompt_stuck_S },
        working: { S: cxprompt_working_S, M: cxprompt_working_S, L: cxprompt_working_S },
        waiting: { S: cxprompt_working_S, M: cxprompt_working_S, L: cxprompt_working_S },
        idle: { S: cxprompt_idle_S, M: cxprompt_idle_S, L: cxprompt_idle_S },
    },
    cxloupe: {
        turn: { S: cxloupe_turn_S, M: cxloupe_turn_S, L: cxloupe_turn_S },
        stuck: { S: cxloupe_stuck_S, M: cxloupe_stuck_S, L: cxloupe_stuck_S },
        working: { S: cxloupe_working_S, M: cxloupe_working_S, L: cxloupe_working_S },
        waiting: { S: cxloupe_working_S, M: cxloupe_working_S, L: cxloupe_working_S },
        idle: { S: cxloupe_idle_S, M: cxloupe_idle_S, L: cxloupe_idle_S },
    },
    cxlab: {
        turn: { S: cxlab_turn_S, M: cxlab_turn_S, L: cxlab_turn_S },
        stuck: { S: cxlab_stuck_S, M: cxlab_stuck_S, L: cxlab_stuck_S },
        working: { S: cxlab_working_S, M: cxlab_working_S, L: cxlab_working_S },
        waiting: { S: cxlab_working_S, M: cxlab_working_S, L: cxlab_working_S },
        idle: { S: cxlab_idle_S, M: cxlab_idle_S, L: cxlab_idle_S },
    },
} as const satisfies Readonly<Record<string, Readonly<Record<Bulb, Readonly<Record<SpriteDetail, SpriteGrid>>>>>>;
export type SpriteKind = keyof typeof spriteGrids;

export const modelSprites = { opus: 'ragdoll', sonnet: 'ginger', haiku: 'tuxedo', codex: 'cxprompt', fable: 'fox', sol: 'cxloupe', terra: 'cxprompt', astra: 'cxlab' } as const satisfies Readonly<Record<string, SpriteKind>>;
export const noWorkerSprite: SpriteKind = 'ipdroid';

/** Match model identifiers, never the session's agent flavour. Unknown/unloaded models use Droid. */
export function spriteForModel(model: string | null | undefined): SpriteKind {
    const id = model?.trim().toLowerCase().replace(/_/g, '-') ?? '';
    const parts = id.split(/[-./:\s]+/);
    if (/^(claude\b|opus\b|sonnet\b|haiku\b|fable\b)/.test(id)) {
        for (const tier of ['opus', 'sonnet', 'haiku', 'fable'] as const) {
            if (parts.includes(tier)) return modelSprites[tier];
        }
        return modelSprites.opus;
    }
    if (/^gpt\b/.test(id) || id === 'codex') {
        for (const tier of ['sol', 'terra', 'astra'] as const) {
            if (parts.includes(tier)) return modelSprites[tier];
        }
        return modelSprites.codex;
    }
    return noWorkerSprite;
}

/** Style B from mockup 12, limited to the approved round-8 cast. E marks a stateful eye. */
export const asciiSprites = {
    ragdoll: { full: [' /\\_/\\', '{(E.E)}', ' {"v"}'], face: 1, mini: '{E.E}' },
    ginger: { full: [' /\\_/\\', '(=E.E=)', ' (")(")'], face: 1, mini: '=E.E=' },
    tuxedo: { full: [' /\\_/\\', '( E.E )', '  >o<'], face: 1, mini: '(E.E)' },
    fox: { full: ['/\\   /\\', '\\ E.E /', ' \\_v_/'], face: 1, mini: '\\E.E/' },
    ipdroid: { full: ['     o', '  .-/-.', ' ( (E) )', "  'u-u'"], face: 2, mini: '((E))' },
    ipb: { full: ['   o', ' .-|-.', ' |E E|', " '---'", '  [_]'], face: 2, mini: '|E E|' },
    cxprompt: { full: ['.----.', '|>E  |', "'----'", ' d  b'], face: 1, mini: '[>E]' },
    cxloupe: { full: [' .---._', ' |E (E))', " '---'"], face: 1, mini: 'E(E))' },
    cxlab: { full: [' .----.', '[=E==E=]', " /'--'\\"], face: 1, mini: '[=E=E=]' },
} as const satisfies Readonly<Record<SpriteKind, { full: readonly string[]; face: number; mini: string }>>;

export function spriteAscii(kind: SpriteKind, bulb: Bulb, detail: SpriteDetail) {
    const base = asciiSprites[kind];
    let full: readonly string[] = base.full;
    let mini: string = base.mini;
    if (kind === 'ipb') {
        if (bulb === 'working' || bulb === 'waiting') {
            full = ['  .o.', ' /.-.\\', 'd|E E|b', " '---'", '  [_]'];
            mini = 'd|E E|b';
        } else if (bulb === 'idle') {
            full = ['   o', ' .-|-.', ' |E E|', " '---'", ' d[_]b'];
        }
    }
    const eye = bulb === 'stuck' ? 'x' : kind === 'cxprompt'
        ? (bulb === 'turn' ? '_' : bulb === 'idle' ? ' ' : '.')
        : (bulb === 'turn' ? 'o' : '-');
    const lines = detail === 'S' ? [mini] : full;
    const runs = lines.map(line => line.split(/(E)/).filter(Boolean).map(text => ({ text: text === 'E' ? eye : text, eye: text === 'E' })));
    return {
        lines: runs.map(line => line.map(run => run.text).join('')),
        runs,
        face: detail === 'S' ? 0 : base.face,
    };
}
