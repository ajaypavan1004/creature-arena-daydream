# app.tcl -- the app's manifest, read by `dream` (sdk/docs/apps.md).
name     creaturearena
title    Creature Arena
kind     game
about    {The 16 Genome Wrapped creatures fight in a ring of light. Your hand on your ring steers your creature, your other hand: a pinch bites, a fist sprints, and each creature's four genes decide what coffee, bitter greens, energy orbs and the day and night do to it.}
version  0.1
players  {min 2 max 2}
tracking {profile fast lookahead 0.080}
uses     {folk 1 table 1 hands 1 light 1 players 1 sound 1 table-ui 1 controls 1}
budget   {frameMs 2 gpuMs 2 cores 0.25}
programs {creaturearena.folk}
tests    {test/test-creaturearena.folk}
bench    {scene test/scene.tcl seconds 10}
