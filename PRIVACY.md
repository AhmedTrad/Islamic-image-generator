# Privacy Policy: Islamic Cards

Effective date: 30 October 2026

Islamic Cards is a personal, non-commercial tool run by dalawa, the owner of this repository. Once a day it publishes an image Pin to the owner's own Pinterest board. Each Pin is a card showing an authentic hadith with its source, narrator and a short lesson. The tool's code is public in this repository.

## Who uses it

Only the repository owner uses Islamic Cards, on their own Pinterest account. It does not let anyone else sign in, and it does not access other Pinterest users' accounts or data.

## What it accesses on Pinterest

The owner signs in once through Pinterest's authorization page. The tool then uses Pinterest's API for these purposes only:

- **Access tokens.** It keeps the owner's access and refresh tokens so it can post each day.
- **Boards.** During setup it lists the owner's boards so the owner can choose one for the daily Pins.
- **Recent Pins on the chosen board.** Before posting, it reads the titles and creation times of the latest Pins on that board. This prevents posting the same card twice on one day.
- **Creating Pins.** It creates one Pin a day on the chosen board.

It requests the `boards:read`, `boards:write`, `pins:read` and `pins:write` permissions. It never edits or deletes existing Pins or boards.

## Where data is stored

- **Tokens** are stored as encrypted GitHub Actions secrets in this repository. Only the owner and the daily job can use them.
- **The rendered card and its caption** are kept as a GitHub Actions artifact for 14 days, then deleted automatically.
- **Nothing else is stored.** The tool keeps no database, analytics or logs of personal information.

No data is sold, shared with advertisers, or used for any purpose other than posting the owner's daily Pin.

## Services involved

- **Pinterest** receives the Pins and handles sign-in. See [Pinterest's privacy policy](https://policy.pinterest.com/privacy-policy).
- **GitHub** hosts the code and runs the daily job. See [GitHub's privacy statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement).
- **Google Fonts** and the **Tailwind CSS CDN** supply the fonts and styles used to draw the card.

## The card website

The card page in this repository (`index.html`) runs entirely in the visitor's browser. It saves display preferences, such as the card format, in the browser's local storage on the visitor's own device. It sets no cookies and collects no personal information. Loading the page fetches fonts from Google Fonts and styles from the Tailwind CSS CDN. Those services may see the visitor's IP address, as with any web request.

## Removing access

The owner can stop the tool at any time by revoking its access in Pinterest's settings under "Apps", or by deleting the repository's secrets. Revoking access makes the stored tokens useless.

## Changes

Any change to this policy is published in this file, with a new effective date. The file's history on GitHub shows every earlier version.

## Contact

Questions about this policy can be raised by opening an issue at <https://github.com/AhmedTrad/Islamic-image-generator/issues>.
