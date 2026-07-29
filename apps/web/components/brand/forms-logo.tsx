import type { SVGProps } from 'react';

/**
 * The Dapta Forms marks.
 *
 * Both are the letter F from Poppins SemiBold Italic — the product's own UI face
 * (`lib/fonts.ts`) and the face the rest of the suite is set in — cut along the
 * stem's right edge so the two arms carry the lime. The cut rides Poppins' own
 * 10 degree italic angle, NOT the 13.15 degree lean of the parent Dapta D: the D
 * is separate artwork and keeps its own angle, which is why it is drawn with its
 * own skew in the lockup below.
 *
 * The split is baked as two polygons rather than an SVG <clipPath>, so these
 * carry no element ids — two instances on one page cannot collide, and they
 * render as server components with no hooks.
 *
 * Ink is `currentColor`, so a mark inherits whatever text colour it sits in and
 * follows dark/light without a second asset. Only the lime is literal.
 */

const LIME = '#cae940';

/** Just the F. Use where the lockup would not fit: collapsed rails, tiles, badges. */
export function FormsMark({ title, ...props }: SVGProps<SVGSVGElement> & { title?: string }) {
  return (
    <svg
      viewBox="0 0 736.5 879.5"
      role={title ? 'img' : 'presentation'}
      aria-hidden={title ? undefined : true}
      focusable="false"
      {...props}
    >
      {title ? <title>{title}</title> : null}
      <g transform="translate(73.7 788.7) scale(1 -1)">
        <path d="M210.2 297.0 210.0 297.0 188.1 171.8 157.8 0.0 17.0 0.0 141.0 698.0 280.9 698.0Z" fill="currentColor" />
        <path d="M572.0 698.0 552.0 588.0 262.0 588.0 230.0 405.0 452.0 405.0 433.0 297.0 210.2 297.0 188.1 171.8 158.0 0.0 157.8 0.0 280.9 698.0Z" fill={LIME} />
      </g>
    </svg>
  );
}

/**
 * `Forms.` on its own — the product name without the parent company. Roughly
 * 2.5:1, so it reads at a size where the 6:1 lockup would be a smear. Use it
 * inside the app, where the surrounding chrome already says Dapta.
 */
export function FormsWordmark({ title, ...props }: SVGProps<SVGSVGElement> & { title?: string }) {
  return (
    <svg
      viewBox="0 0 3412.3 1115.6"
      role={title ? 'img' : 'presentation'}
      aria-hidden={title ? undefined : true}
      focusable="false"
      {...props}
    >
      {title ? <title>{title}</title> : null}
      <g transform="translate(76.8 774.8) scale(1 -1)">
        <path transform="translate(0.0 0)" d="M210.2 297.0 210.0 297.0 188.1 171.8 157.8 0.0 17.0 0.0 141.0 698.0 280.9 698.0Z" fill="currentColor" />
        <path transform="translate(0.0 0)" d="M572.0 698.0 552.0 588.0 262.0 588.0 230.0 405.0 452.0 405.0 433.0 297.0 210.2 297.0 188.1 171.8 158.0 0.0 157.8 0.0 280.9 698.0Z" fill="#cae940" />
        <path transform="translate(520.0 0)" d="M25 224Q25 318 69.5 395.5Q114 473 191.5 518.0Q269 563 364 563Q435 563 490.5 533.5Q546 504 576.5 451.0Q607 398 607 329Q607 234 562.0 157.0Q517 80 438.5 35.5Q360 -9 265 -9Q194 -9 139.5 20.0Q85 49 55.0 102.0Q25 155 25 224ZM462 318Q462 378 428.5 410.5Q395 443 344 443Q293 443 253.5 414.0Q214 385 192.0 336.5Q170 288 170 234Q170 175 201.5 143.0Q233 111 284 111Q334 111 375.0 140.0Q416 169 439.0 217.0Q462 265 462 318Z" fill="currentColor" />
        <path transform="translate(1148.0 0)" d="M427 562 401 415H364Q302 415 264.5 388.0Q227 361 210 296L158 0H17L115 554H256L239 456Q275 506 323.0 534.0Q371 562 427 562Z" fill="currentColor" />
        <path transform="translate(1542.0 0)" d="M995 382Q995 350 990 325L932 0H793L847 306Q850 324 850 341Q850 389 823.5 414.5Q797 440 748 440Q690 440 650.0 405.5Q610 371 600 306V307L545 0H406L460 306Q463 324 463 340Q463 389 436.0 414.5Q409 440 360 440Q305 440 265.5 407.5Q226 375 214 315L158 0H17L115 554H256L244 488Q277 522 323.0 542.0Q369 562 420 562Q485 562 531.0 534.5Q577 507 596 456Q631 504 687.5 533.0Q744 562 805 562Q893 562 944.0 515.0Q995 468 995 382Z" fill="currentColor" />
        <path transform="translate(2580.0 0)" d="M17 152Q17 159 19 175H155Q152 140 176.0 118.5Q200 97 244 97Q284 97 310.5 111.5Q337 126 337 154Q337 179 312.5 194.0Q288 209 235 228Q182 247 147.0 265.0Q112 283 87.0 315.0Q62 347 62 396Q62 445 90.5 483.0Q119 521 170.0 542.0Q221 563 287 563Q350 563 398.0 542.0Q446 521 472.5 483.5Q499 446 499 398Q499 386 498 380H368Q371 415 348.0 436.0Q325 457 281 457Q245 457 222.0 441.5Q199 426 199 400Q199 374 225.0 357.5Q251 341 305 321Q359 300 391.5 282.5Q424 265 448.0 234.5Q472 204 472 158Q472 107 441.0 69.0Q410 31 356.0 11.0Q302 -9 234 -9Q173 -9 123.5 11.5Q74 32 45.5 68.5Q17 105 17 152Z" fill="currentColor" />
        <path transform="translate(3120.0 0) skewX(10)" d="M0 0h118.0v118.0h-118.0Z" fill="#cae940" />
      </g>
    </svg>
  );
}

/** The full `Dapta Forms.` lockup. Roughly 6:1, so give it width before height. */
export function FormsLockup({ title, ...props }: SVGProps<SVGSVGElement> & { title?: string }) {
  return (
    <svg
      viewBox="0 0 6640.1 1115.6"
      role={title ? 'img' : 'presentation'}
      aria-hidden={title ? undefined : true}
      focusable="false"
      {...props}
    >
      {title ? <title>{title}</title> : null}
      <g transform="translate(76.8 774.8) scale(1 -1)">
        <path transform="translate(-163.3 0) scale(6.9800) skewX(13.15)" d="M39,100 H64.5 A46,50 0 0 0 64.5,0 H39 V17.5 H64.5 A28.5,32.5 0 0 1 64.5,82.5 H39 Z" fill="currentColor" />
        <path transform="translate(-163.3 0) scale(6.9800) skewX(13.15)" d="M19.8 15.6h18.8v18.4h-18.8Z" fill="#cae940" />
        <path transform="translate(679.6 0)" d="M334 563Q396 563 438.5 538.0Q481 513 501 475L515 554H656L558 0H417L432 81Q399 42 346.5 16.5Q294 -9 232 -9Q171 -9 124.0 18.5Q77 46 51.0 96.5Q25 147 25 214Q25 245 31 279Q46 363 90.5 428.0Q135 493 199.0 528.0Q263 563 334 563ZM470 315Q470 374 435.5 407.0Q401 440 349 440Q310 440 273.5 421.0Q237 402 210.0 365.5Q183 329 174 279Q171 260 171 243Q171 183 205.0 148.5Q239 114 291 114Q330 114 367.0 133.5Q404 153 430.5 190.0Q457 227 466 277Q470 303 470 315Z" fill="currentColor" />
        <path transform="translate(1347.6 0)" d="M440 563Q502 563 549.5 536.5Q597 510 623.0 460.0Q649 410 649 343Q649 312 643 279Q628 194 583.0 128.5Q538 63 474.0 27.0Q410 -9 340 -9Q279 -9 236.5 16.0Q194 41 172 79L112 -264H-29L115 554H256L242 474Q276 512 327.5 537.5Q379 563 440 563ZM503 315Q503 374 469.0 407.0Q435 440 382 440Q344 440 307.0 420.5Q270 401 243.0 364.0Q216 327 207 277Q203 251 203 239Q203 180 237.5 147.0Q272 114 324 114Q363 114 400.0 134.0Q437 154 464.0 191.0Q491 228 500 279Q503 299 503 315Z" fill="currentColor" />
        <path transform="translate(2015.6 0)" d="M211 171Q210 165 210 155Q210 135 221.5 126.5Q233 118 260 118H326L305 0H216Q66 0 66 125Q66 149 70 172L117 439H51L71 554H138L162 691H303L279 554H402L382 439H258Z" fill="currentColor" />
        <path transform="translate(2393.6 0)" d="M334 563Q396 563 438.5 538.0Q481 513 501 475L515 554H656L558 0H417L432 81Q399 42 346.5 16.5Q294 -9 232 -9Q171 -9 124.0 18.5Q77 46 51.0 96.5Q25 147 25 214Q25 245 31 279Q46 363 90.5 428.0Q135 493 199.0 528.0Q263 563 334 563ZM470 315Q470 374 435.5 407.0Q401 440 349 440Q310 440 273.5 421.0Q237 402 210.0 365.5Q183 329 174 279Q171 260 171 243Q171 183 205.0 148.5Q239 114 291 114Q330 114 367.0 133.5Q404 153 430.5 190.0Q457 227 466 277Q470 303 470 315Z" fill="currentColor" />
        <path transform="translate(3227.8 0)" d="M210.2 297.0 210.0 297.0 188.1 171.8 157.8 0.0 17.0 0.0 141.0 698.0 280.9 698.0Z" fill="currentColor" />
        <path transform="translate(3227.8 0)" d="M572.0 698.0 552.0 588.0 262.0 588.0 230.0 405.0 452.0 405.0 433.0 297.0 210.2 297.0 188.1 171.8 158.0 0.0 157.8 0.0 280.9 698.0Z" fill="#cae940" />
        <path transform="translate(3747.8 0)" d="M25 224Q25 318 69.5 395.5Q114 473 191.5 518.0Q269 563 364 563Q435 563 490.5 533.5Q546 504 576.5 451.0Q607 398 607 329Q607 234 562.0 157.0Q517 80 438.5 35.5Q360 -9 265 -9Q194 -9 139.5 20.0Q85 49 55.0 102.0Q25 155 25 224ZM462 318Q462 378 428.5 410.5Q395 443 344 443Q293 443 253.5 414.0Q214 385 192.0 336.5Q170 288 170 234Q170 175 201.5 143.0Q233 111 284 111Q334 111 375.0 140.0Q416 169 439.0 217.0Q462 265 462 318Z" fill="currentColor" />
        <path transform="translate(4375.8 0)" d="M427 562 401 415H364Q302 415 264.5 388.0Q227 361 210 296L158 0H17L115 554H256L239 456Q275 506 323.0 534.0Q371 562 427 562Z" fill="currentColor" />
        <path transform="translate(4769.8 0)" d="M995 382Q995 350 990 325L932 0H793L847 306Q850 324 850 341Q850 389 823.5 414.5Q797 440 748 440Q690 440 650.0 405.5Q610 371 600 306V307L545 0H406L460 306Q463 324 463 340Q463 389 436.0 414.5Q409 440 360 440Q305 440 265.5 407.5Q226 375 214 315L158 0H17L115 554H256L244 488Q277 522 323.0 542.0Q369 562 420 562Q485 562 531.0 534.5Q577 507 596 456Q631 504 687.5 533.0Q744 562 805 562Q893 562 944.0 515.0Q995 468 995 382Z" fill="currentColor" />
        <path transform="translate(5807.8 0)" d="M17 152Q17 159 19 175H155Q152 140 176.0 118.5Q200 97 244 97Q284 97 310.5 111.5Q337 126 337 154Q337 179 312.5 194.0Q288 209 235 228Q182 247 147.0 265.0Q112 283 87.0 315.0Q62 347 62 396Q62 445 90.5 483.0Q119 521 170.0 542.0Q221 563 287 563Q350 563 398.0 542.0Q446 521 472.5 483.5Q499 446 499 398Q499 386 498 380H368Q371 415 348.0 436.0Q325 457 281 457Q245 457 222.0 441.5Q199 426 199 400Q199 374 225.0 357.5Q251 341 305 321Q359 300 391.5 282.5Q424 265 448.0 234.5Q472 204 472 158Q472 107 441.0 69.0Q410 31 356.0 11.0Q302 -9 234 -9Q173 -9 123.5 11.5Q74 32 45.5 68.5Q17 105 17 152Z" fill="currentColor" />
        <path transform="translate(6347.8 0) skewX(10)" d="M0 0h118.0v118.0h-118.0Z" fill="#cae940" />
      </g>
    </svg>
  );
}
