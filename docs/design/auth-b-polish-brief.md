# Auth Variant B polish brief

Figma channel `claudefigmam` (pass `channel` on every call). Frames 1440x900 at y=4300:
130:221 Sign-In (pilot), 130:267 Sign-Up, 130:312 Forgot-Password, 130:337 Check-Email, 130:357 Reset-Password.
Sign-In tree: root 130:221 (bg web-background #0e0e10) > BG/Auth-Art 130:433 [role: artwork] (image fill) + Layout 130:391.
Reference: Jarvis onboarding (seamless photo fading into near-black, display serif headline, calm form column, right-aligned glowing primary).
Research: scratchpad/auth-research.md (Clerk/Framer split fade, Linear/Vercel fields, glow primary).

Rules: design-rules skill; min font 13px; auto-layout; bind tokens; no spacer rects; set_fill_color {r,g,b,a} for alpha; set_layout_sizing, never resize_node; keep copy.
Verify every change by export (force_refresh), contrast_check_frame, find_overlaps.

## Round 1 accepted findings
1. Art: hard vertical crop at x~770, stock-render feel. Replace with a seamless atmospheric image (dark, lots of empty near-black margin, soft right and bottom fade into #0e0e10). No hard edge anywhere.
2. Headline: heavy grotesk. Use a display serif (check file fonts: Instrument Serif, Newsreader, Fraunces, Playfair, DM Serif, else Georgia) weight 400, ~48-56px, tracking -1 to -2%.
3. Primary: add glow (drop shadow brand green 35%, y4 blur 20) + subtle inner top highlight; keep right-aligned.
4. Fields: fill white 4%, 1px stroke white 10%, height 44-48, radius 10. Social buttons same surface language, lighter weight label. Divider hairlines white 8%, "or" 13px muted.
5. Vertical balance: form block vertically centered in the viewport (slightly above center), footnote anchored, consistent 4-scale rhythm: group gap 32-40, inner 8-12.
Rejected: 2px borders (heavier is wrong direction), desaturate links (product brand), header padding (already 82px).

## Round 1 result
Art: scratchpad/art1.jpg (terraced hills, green glow) on 130:433 at 1440x900, old fade 130:434 hidden. Form: Instrument Serif 52/56 -1.5%, fields/social white 4%/10%, glow primary, Form Block 130:529.

## Round 2 accepted findings
1. Head (title+subtitle) to social buttons: 40px (group gap), divider margin 24 above/below.
2. Trust footnote floats ~100px below actions, detached. Move it into Form Block 32px under the actions row; re-center the whole block vertically (slightly above middle).
3. Hill ridge and glow bleed behind the headline/social area (x 820-900, y 150-320). Add a soft right-side darkening (gradient from #0e0e10 0% alpha at x~700 to ~85% at x~860) so the form column sits on clean near-black.
Rejected: baseline nudges for Forgot password / actions row / Help / shield icon (auto-layout centered, measured aligned); reducing actions row gap (space-between is intentional, reference does the same).

## Round 2 result
Options 130:530 (gap 24), card gap 40, Footer 130:531 (actions + trust, gap 32), Body centers Form Block with bottom pad 32. Fade/Form-Column 130:434 gradient #0e0e10 0%@700 -> 85%@860 -> 92% right; 130:435 hidden.

## Round 3 accepted
1. Placeholder text: raise to >= 4.5:1 on the field (roughly white 50-55%).
Rejected: sans headline (user explicitly asked for serif), remove image (core of reference), "or" spacing (measured 24), Forgot alignment (already flush right), Help size (passes AA, header chrome).

## Rollout (Sign-In is the source of truth)
Mirror on 130:267, 130:312, 130:337, 130:357: art frame 1440x900 with art1.jpg FILL + Fade/Form-Column gradient, Instrument Serif title 52/56 -1.5%, field/social surface (white 4% fill, white 10% stroke, radius 10, 48h), divider white 8%, primary glow (green 35% y4 blur20 + white 20% inner top 1px) right aligned, group gaps 40/24/16/32, footnote 32 under actions, form block centered with 32 bottom pad. Keep each screen's copy.
