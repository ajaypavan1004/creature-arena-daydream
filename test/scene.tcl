# scene.tcl -- dream budget's scene for Creature Arena: the busiest
# moment of a fight rather than the pick screen. Two creatures with the
# biggest pictures (Dawnflare, Thunderjaw) fight with three power ups
# out, while the bench's hands sweep and pinch.

proc sceneStart {} {
    Assert! when {Wish creaturearena is played} with environment [list [list this bench-start]]
    # Stand-ins for the GPU's textures, so the pictures are built as on the table.
    Assert! when {Claim the creature arena textures are {1 2}} with environment [list [list this bench-textures]]
    Assert! when {
        When the creature arena library is /lib/ {
            $lib setGenes 1 {0 1 0 1 0}
            $lib setGenes 2 {1 0 1 0 2}
            $lib startFight
            $lib drop coffee 0 -250
            $lib drop greens 150 200
            $lib drop orb -150 200
        }
    } with environment [list [list this bench-fight]]
}
