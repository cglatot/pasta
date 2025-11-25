# PASTA
Audio and Subtitle Track Changer for Plex

DockerHub Link: https://hub.docker.com/r/cglatot/pasta

Unraid Installation: This is now available on the Commmunity Applications list thanks to https://github.com/selfhosters/unRAID-CA-templates

Encountered a bug, or have a feature request? Log it here: https://github.com/cglatot/pasta/issues

Enjoying the tool? Considering adding to my coffee / energy drink fund :)

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/cglatot)

## What is PASTA?

Do you watch TV Shows with multiple languages and subtitles and wish you could change them for the entire show, rather than needing to do it for *every. single. episode*?

Do you want to **easily** go through and select specific audio tracks and subtitles, as well as set the tracks and subtitles or entire shows, or single episodes very quickly?

Are you looking for an easier way to find **forced** or **English (SRT)** subtitle files? Then PASTA is for you!

PASTA is entirely client-side. This means that you are not passing anything to someones server to do this (other than the Plex Server), and it also means I don't have to worry about standing up a server.

When I first began developing this for myself, I was calling it *Audio Track Automation for Plex*, so adding "subtitles" to it, and rearranging the letters gave birth to PASTA.

This was born out of a desire, one that I had seen others have as well, but that I had only seen one other solution for. However, it was in command line and I wanted something a bit more appealing to look at, so I built this.

I decided to make it publicly available for others to take a look, download it yourself and use it locally, or make suggestions. I'm by no means finished with PASTA - I still have plenty of ideas for how I can add more to it, as well as fix any bugs that crop up.

## How do I use PASTA?

There are a few different ways to use PASTA:
- You can use it directly on the web at https://www.pastatool.com
- You can run it in a Docker container (see below)
- You can also run this locally yourself. Just download the source code from github.

If you use Unraid, this is now available in the Community Applications.

## Important Notes

There are some things I would like to point out, however:
- This works **MUCH** faster if you are on the same network as the Plex Server.
- The UI is pretty self-explanatory, you should be able to just close this pop-up and follow along.

## Docker

Here is an example compose to help you get started creating a container.

```yaml
---
version: "3"

services:
  pasta:
    image: cglatot/pasta
    container_name: pasta
    ports:
      - 8087:80
    restart: unless-stopped
```

## About

**Why are you asking me to sign in?** This tool sets the audio and subtitle tracks for Movies and TV Shows with respect to your account only. You must login to this tool so that we can view and change these tracks on your behalf.

If you would like more information, please click on the **Help & About** in the top right of the page.
