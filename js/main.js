var plexUrl;
var plexToken;
var libraryNumber = ""; // The Library ID that was clicked
var showId = ""; // Stores the Id for the most recently clicked series
var seasonsList = []; // Stores the Ids for all seasons of the most recently clicked series
var seasonId = ""; // Store the Id of the most recently clicked season
var episodeId = ""; // Stores the Id of the most recently clicked episode

$(document).ready(() => {
    // Validation values to enable the Connect to Plex Button
    let validUrl = false;
    let validToken = false;

    // Validation listeners on the Plex URL Input
    $('#plexUrl').on("input", () => {
        if ($('#plexUrl').val() != "") {
            $('#plexUrl').removeClass("is-invalid").addClass("is-valid");
            validUrl = true;
        }
        else {
            $('#plexUrl').removeClass("is-valid").addClass("is-invalid");
            validUrl = false;
        }
        // Check if we can enable the Connect to Plex button
        if (validUrl && validToken) {
            $("#btnConnectToPlex").prop("disabled", false);
        }
        else {
            $("#btnConnectToPlex").prop("disabled", true);
        }
    });

    // Validation listeners on the Plex Token Input
    $('#plexToken').on("input", () => {
        if ($('#plexToken').val() != "") {
            $('#plexToken').removeClass("is-invalid").addClass("is-valid");
            validToken = true;
        }
        else {
            $('#plexToken').removeClass("is-valid").addClass("is-invalid");
            validToken = false;
        }
        // Check if we can enable the Connect to Plex button
        if (validUrl && validToken) {
            $("#btnConnectToPlex").prop("disabled", false);
        }
        else {
            $("#btnConnectToPlex").prop("disabled", true);
        }
    });
});

function connectToPlex() {
    plexUrl = $("#plexUrl").val().trim();
    plexToken = $("#plexToken").val().trim();

    if (plexUrl.toLowerCase().indexOf("http") < 0) {
        plexUrl = `http://${plexUrl}`
    }

    $.ajax({
        "url": `${plexUrl}/library/sections/`,
        "method": "GET",
        "headers": {
            "X-Plex-Token": plexToken,
            "Accept": "application/json"
        },
        "success": (data) => {
            $("#authWarningText").empty();
            displayLibraries(data)
        },
        "error": (data) => {
            if (data.status == 401) {
                console.log("Unauthorized");
                $("#authWarningText").html(`<div class="alert alert-warning alert-dismissible fade show mt-3" role="alert">
                        <strong>Warning:</strong> Unauthorized (401) - Please check that your X-Plex-Token is correct, and you are trying to connect to the correct Plex server.
                        <button type="button" class="close" data-dismiss="alert" aria-label="Close">
                            <span aria-hidden="true">&times;</span>
                        </button>
                    </div>`);
            }
            else {
                console.log("Unkown error, most likely bad URL / IP");
                $("#authWarningText").html(`<div class="alert alert-warning alert-dismissible fade show mt-3" role="alert">
                        <strong>Warning:</strong> Unkown Error (0) - Please verify the URL and try again.
                        <button type="button" class="close" data-dismiss="alert" aria-label="Close">
                            <span aria-hidden="true">&times;</span>
                        </button>
                    </div>`);
            }
            $("#libraryTable tbody").empty();
            $("#tvShowsTable tbody").empty();
            $("#seasonsTable tbody").empty();
            $("#episodesTable tbody").empty();
            $("#audioTable tbody").empty();
            $("#subtitleTable tbody").empty();
        }
    });
}

function displayLibraries(data) {
    const libraries = data.MediaContainer.Directory;
    // console.log(libraries);

    $("#libraryTable tbody").empty();
    $("#tvShowsTable tbody").empty();
    $("#seasonsTable tbody").empty();
    $("#episodesTable tbody").empty();
    $("#audioTable tbody").empty();
    $("#subtitleTable tbody").empty();

    for (let i = 0; i < libraries.length; i++) {
        let rowHTML = `<tr onclick="getAlphabet(${libraries[i].key}, this)">
                        <td>${libraries[i].title}</td>
                    </tr>`;
        $("#libraryTable tbody").append(rowHTML);
    }
}

function getAlphabet(uid, row) {
    $.ajax({
        "url": `${plexUrl}/library/sections/${uid}/firstCharacter`,
        "method": "GET",
        "headers": {
            "X-Plex-Token": plexToken,
            "Accept": "application/json"
        },
        "success": (data) => {
            libraryNumber = uid;
            displayAlphabet(data, row);
            $('#series-tab').tab('show');
        },
        "error": (data) => {
            console.log("ERROR L131");
            console.log(data);
        }
    });
}

function displayAlphabet(data, row) {
    const availableAlphabet = data.MediaContainer.Directory;
    // console.log(availableAlphabet);

    $("#tvShowsTable tbody").empty();
    $("#seasonsTable tbody").empty();
    $("#episodesTable tbody").empty();
    $("#audioTable tbody").empty();
    $("#subtitleTable tbody").empty();

    $(row).siblings().removeClass("table-active");
    $(row).addClass("table-active");
    $('#alphabetGroup').children().removeClass("btn-dark").addClass("btn-outline-dark").prop("disabled", true);

    for (let i = 0; i < availableAlphabet.length; i++) {
        if (availableAlphabet[i].title == "#") {
            $(`#btnHash`).prop("disabled", false);
        }
        else {
            $(`#btn${availableAlphabet[i].title}`).prop("disabled", false);
        }
    }
}

function getLibraryByLetter(element) {
    let letter = $(element).text();
    if (letter == "#") letter = "%23";
    // console.log("getLibraryByLetter: " + letter);

    $(element).siblings().removeClass("btn-dark").addClass("btn-outline-dark");
    $(element).removeClass("btn-outline-dark").addClass("btn-dark");

    $.ajax({
        "url": `${plexUrl}/library/sections/${libraryNumber}/firstCharacter/${letter}`,
        "method": "GET",
        "headers": {
            "X-Plex-Token": plexToken,
            "Accept": "application/json"
        },
        "success": (data) => displayTitles(data),
        "error": (data) => {
            console.log("ERROR L178");
            console.log(data);
        }
    });
}

function displayTitles(titles) {
    const tvShows = titles.MediaContainer.Metadata;
    // console.log(tvShows);
    $("#tvShowsTable tbody").empty();
    $("#seasonsTable tbody").empty();
    $("#episodesTable tbody").empty();
    $("#audioTable tbody").empty();
    $("#subtitleTable tbody").empty();

    for (let i = 0; i < tvShows.length; i++) {
        let rowHTML = `<tr onclick="getTitleInfo(${tvShows[i].ratingKey}, this)">
                        <td>${tvShows[i].title}</td>
                        <td>${tvShows[i].year}</td>
                    </tr>`;
        $("#tvShowsTable tbody").append(rowHTML);
    }
}

function getTitleInfo(uid, row) {
    showId = uid;
    $.ajax({
        "url": `${plexUrl}/library/metadata/${uid}/children`,
        "method": "GET",
        "headers": {
            "X-Plex-Token": plexToken,
            "Accept": "application/json"
        },
        "success": (data) => {
            showTitleInfo(data, row);
            $('#episodes-tab').tab('show');
        },
        "error": (data) => {
            console.log("ERROR L143");
            console.log(data);
            if (data.status == 400) {
                // This is a "bad request" - this usually means a Movie was selected
                $('#progressModal #progressModalTitle').empty();
                $('#progressModal #progressModalTitle').text(`Invalid TV Show`);
                $('#progressModal #modalBodyText').empty();
                $('#progressModal #modalBodyText').append(`<div class="alert alert-warning mb-0" role="alert">
                        <div class="d-flex align-items-center">
                            This does not appear to be a valid TV Series, or this TV Series does not have any seasons associated with it.<br>
                            Please choose a valid TV Series; update the TV Series to have at least 1 Season; or go back and choose the proper library for TV Series.
                        </div>
                    </div>`);
                $('#progressModal').modal();
            }
        }
    });
}

function showTitleInfo(data, row) {
    const seasons = data.MediaContainer.Metadata;
    seasonsList.length = 0;
    // console.log(seasons);

    $(row).siblings().removeClass("table-active");
    $(row).addClass("table-active");

    $("#seasonsTable tbody").empty();
    $("#episodesTable tbody").empty();
    $("#audioTable tbody").empty();
    $("#subtitleTable tbody").empty();

    for (let i = 0; i < seasons.length; i++) {
        seasonsList.push(seasons[i].ratingKey);
        let rowHTML = `<tr onclick="getSeasonInfo(${seasons[i].ratingKey}, this)">
                        <td>${seasons[i].title}</td>
                    </tr>`;
        $("#seasonsTable tbody").append(rowHTML);
    }
}

function getSeasonInfo(uid, row) {
    seasonId = uid;
    $.ajax({
        "url": `${plexUrl}/library/metadata/${uid}/children`,
        "method": "GET",
        "headers": {
            "X-Plex-Token": plexToken,
            "Accept": "application/json"
        },
        "success": (data) => showSeasonInfo(data, row),
        "error": (data) => {
            console.log("ERROR L183");
            console.log(data);
        }
    });
}

function showSeasonInfo(data, row) {
    const episodes = data.MediaContainer.Metadata;
    // console.log(episodes);

    $(row).siblings().removeClass("table-active");
    $(row).addClass("table-active");

    $("#episodesTable tbody").empty();
    $("#audioTable tbody").empty();
    $("#subtitleTable tbody").empty();

    for (let i = 0; i < episodes.length; i++) {
        let rowHTML = `<tr onclick="getEpisodeInfo(${episodes[i].ratingKey}, this)">
                        <td>${episodes[i].title}</td>
                    </tr>`;
        $("#episodesTable tbody").append(rowHTML);
    }
}

function getEpisodeInfo(uid, row) {
    episodeId = uid;
    $.ajax({
        "url": `${plexUrl}/library/metadata/${uid}`,
        "method": "GET",
        "headers": {
            "X-Plex-Token": plexToken,
            "Accept": "application/json"
        },
        "success": (data) => showEpisodeInfo(data, row),
        "error": (data) => {
            console.log("ERROR L220");
            console.log(data);
        }
    });
}

function showEpisodeInfo(data, row) {
    const streams = data.MediaContainer.Metadata[0].Media[0].Part[0].Stream;
    const partId = data.MediaContainer.Metadata[0].Media[0].Part[0].id;
    // console.log(partId);
    // console.log(streams);

    $(row).siblings().removeClass("table-active");
    $(row).addClass("table-active");

    $("#audioTable tbody").empty();
    $("#subtitleTable tbody").empty();

    // We need to keep track if any subtitles are selected - if not, then we need to make the subtitle row table-active
    let subtitlesChosen = false;

    for (let i = 0; i < streams.length; i++) {
        if (streams[i].streamType == 2) {
            let rowHTML = `<tr ${streams[i].selected ? "class='table-active'" : ""} onclick="setAudioStream(${partId}, ${streams[i].id}, this)">
                        <td class="name">${streams[i].displayTitle}</td>
                        <td class="title">${streams[i].title}</td>
                        <td class="language">${streams[i].language}</td>
                        <td class="code">${streams[i].languageCode}</td>
                    </tr>`;
            $("#audioTable tbody").append(rowHTML);
        }
        else if (streams[i].streamType == 3) {
            if (streams[i].selected) subtitlesChosen = true;
            let rowHTML = `<tr ${streams[i].selected ? "class='table-active'" : ""} onclick="setSubtitleStream(${partId}, ${streams[i].id}, this)">
                        <td class="name">${streams[i].displayTitle}</td>
                        <td class="title">${streams[i].title}</td>
                        <td class="language">${streams[i].language}</td>
                        <td class="code">${streams[i].languageCode}</td>
                    </tr>`;
            $("#subtitleTable tbody").append(rowHTML);
        }
    }

    // Append the "No Subtitles" row to the top of the tracks table
    let noSubsRow = `<tr ${subtitlesChosen ? "" : "class='table-active'"} onclick="setSubtitleStream(${partId}, 0, this)">
                        <td class="name">No Subtitles</td>
                        <td class="title">--</td>
                        <td class="language">--</td>
                        <td class="code">--</td>
                    </tr>`;
    $("#subtitleTable tbody").prepend(noSubsRow);
}

async function setAudioStream(partsId, streamId, row) {
    let singleEpisode = $("#singleEpisode").prop("checked");

    if (singleEpisode) {
        //console.log("Apply Audio Stream to single episode");
        $.ajax({
            "url": `${plexUrl}/library/parts/${partsId}?audioStreamID=${streamId}&allParts=1`,
            "method": "POST",
            "headers": {
                "X-Plex-Token": plexToken,
                "Accept": "application/json"
            },
            "success": (data) => {
                //console.log("success");
                $(row).siblings().removeClass("table-active");
                $(row).addClass("table-active").addClass("success-transition");
                setTimeout(() => {
                    $(row).removeClass('success-transition');
                }, 1500);
            },
            "error": (data) => {
                console.log("ERROR L283");
                console.log(data);
            }
        });
    }
    else {
        //console.log("Apply Audio Stream to whole series");
        // Show the modal to set progress
        $('#progressModal #progressModalTitle').empty();
        $('#progressModal #progressModalTitle').text(`Processing Audio Changes`);
        $('#progressModal #modalBodyText').empty();
        $('#progressModal #modalBodyText').append(`<div class="alert alert-warning" role="alert">
                <div class="d-flex align-items-center">
                    <span id="modalTitleText">Please do not close this tab or refresh until the process is complete</span>
                <div class="spinner-border text-warning ml-auto" role="status" aria-hidden="true"></div>
            </div>
        </div>`);
        $('#progressModal').modal();

        let matchPromises = []; // This will store the promises to change the audio for given files. It means we can run in parallel and await them all
        let searchTitle = ($(".title", row).text() == "undefined") ? undefined : $(".title", row).text();
        let searchName = ($(".name", row).text() == "undefined") ? undefined : $(".name", row).text();
        let searchLanguage = ($(".language", row).text() == "undefined") ? undefined : $(".language", row).text();
        let searchCode = ($(".code", row).text() == "undefined") ? undefined : $(".code", row).text();

        // We have the Seasons Ids stored in seasonsList, so iterate over them to get all the episodes
        let episodeList = [];
        for (let i = 0; i < seasonsList.length; i++) {
            let seasonEpisodes = await $.ajax({
                "url": `${plexUrl}/library/metadata/${seasonsList[i]}/children`,
                "method": "GET",
                "headers": {
                    "X-Plex-Token": plexToken,
                    "Accept": "application/json"
                }
            });
            for (let j = 0; j < seasonEpisodes.MediaContainer.Metadata.length; j++) {
                episodeList.push(seasonEpisodes.MediaContainer.Metadata[j].ratingKey);
            }
        }
        //console.log(episodeList);

        // We have the episodes in episodeList, now we need to go through each one and see what streams are available
        for (let i = 0; i < episodeList.length; i++) {
            let episodeData = await $.ajax({
                "url": `${plexUrl}/library/metadata/${episodeList[i]}`,
                "method": "GET",
                "headers": {
                    "X-Plex-Token": plexToken,
                    "Accept": "application/json"
                }
            });
            const episodePartId = episodeData.MediaContainer.Metadata[0].Media[0].Part[0].id;
            const episodeStreams = episodeData.MediaContainer.Metadata[0].Media[0].Part[0].Stream;
            //console.log(episodePartId);
            //console.log(episodeStreams);

            // Loop through each audio stream and check for any matches using the searchTitle, searchName, searchLanguage, searchCode
            let hasMatch = false;
            let matchType = "";
            let potentialMatches = [];
            let selectedTrack = {
                "matchId": "",
                "matchLevel": 0
            };
            let bestMatch;

            for (let j = 0; j < episodeStreams.length; j++) {
                // Audio streams are streamType 2, so we only care about that
                if (episodeStreams[j].streamType == "2") {
                    // If EVERYTHING is a match, even if they are "undefined" then select it
                    if ((episodeStreams[j].title == searchTitle) && (episodeStreams[j].displayTitle == searchName) && (episodeStreams[j].language == searchLanguage) && (episodeStreams[j].languageCode == searchCode)) {
                        if (episodeStreams[j].selected == true) {
                            selectedTrack.matchId = episodeStreams[j].id;
                            selectedTrack.matchLevel = 6;
                        }
                        else {
                            potentialMatches.push({
                                "matchId": episodeStreams[j].id,
                                "matchLevel": 6
                            });
                        }
                    }
                    // If the displayTitle and title are the same, we have an instant match (also rule out any undefined matches)
                    else if ((episodeStreams[j].title == searchTitle) && (episodeStreams[j].displayTitle == searchName) && (episodeStreams[j].title != "undefined") && (episodeStreams[j].displayTitle != "undefined")) {
                        if (episodeStreams[j].selected == true) {
                            selectedTrack.matchId = episodeStreams[j].id;
                            selectedTrack.matchLevel = 5;
                        }
                        else {
                            potentialMatches.push({
                                "matchId": episodeStreams[j].id,
                                "matchLevel": 5
                            });
                        }
                    }
                    // If the titles are the same (rule out undefined match)
                    else if ((episodeStreams[j].title == searchTitle) && (episodeStreams[j].title != "undefined")) {
                        if (episodeStreams[j].selected == true) {
                            selectedTrack.matchId = episodeStreams[j].id;
                            selectedTrack.matchLevel = 4;
                        }
                        else {
                            potentialMatches.push({
                                "matchId": episodeStreams[j].id,
                                "matchLevel": 4
                            });
                        }
                    }
                    // If the names are the same (rule out undefined match)
                    else if ((episodeStreams[j].displayTitle == searchName) && (episodeStreams[j].displayTitle != "undefined")) {
                        if (episodeStreams[j].selected == true) {
                            selectedTrack.matchId = episodeStreams[j].id;
                            selectedTrack.matchLevel = 3;
                        }
                        else {
                            potentialMatches.push({
                                "matchId": episodeStreams[j].id,
                                "matchLevel": 3
                            });
                        }
                    }
                    // If the languages are the same (rule out undefined match)
                    else if ((episodeStreams[j].language == searchLanguage) && (episodeStreams[j].language != "undefined")) {
                        if (episodeStreams[j].selected == true) {
                            selectedTrack.matchId = episodeStreams[j].id;
                            selectedTrack.matchLevel = 2;
                        }
                        else {
                            potentialMatches.push({
                                "matchId": episodeStreams[j].id,
                                "matchLevel": 2
                            });
                        }
                    }
                    // If the language codes are the same (rule out undefined match)
                    else if ((episodeStreams[j].languageCode == searchCode) && (episodeStreams[j].languageCode != "undefined")) {
                        if (episodeStreams[j].selected == true) {
                            selectedTrack.matchId = episodeStreams[j].id;
                            selectedTrack.matchLevel = 1;
                        }
                        else {
                            potentialMatches.push({
                                "matchId": episodeStreams[j].id,
                                "matchLevel": 1
                            });
                        }
                    }
                }
            }

            // If there are no potential matches, then return hasMatch = false so we can skip sending unnecessary commands to plex
            if (potentialMatches.length == 0) {
                hasMatch = false;
            }
            else {
                // If there are potential matches - get the highest matchLevel (most accurate) and compare it to the currently selected track
                bestMatch = potentialMatches.reduce((p, c) => p.matchLevel > c.matchLevel ? p : c);
                if (bestMatch.matchLevel > selectedTrack.matchLevel) {
                    // By default selectedTrack.matchLevel = 0, so even if there is no selected track, this comparison will work
                    hasMatch = true;
                    if (bestMatch.matchLevel == 6) matchType = "Everything";
                    else if (bestMatch.matchLevel == 5) matchType = "Name and Title";
                    else if (bestMatch.matchLevel == 4) matchType = "Title";
                    else if (bestMatch.matchLevel == 3) matchType = "Name";
                    else if (bestMatch.matchLevel == 2) matchType = "Language";
                    else if (bestMatch.matchLevel == 1) matchType = "Language Code";
                }
                else {
                    hasMatch = false;
                }
            }

            if (hasMatch) {
                // There is a match, so update the audio track using the newStreamId and episodePartId
                //console.log(`Episode: ${episodeData.MediaContainer.Metadata[0].title} has a match on the type: ${matchType}, and will set the new Audio Track to: ${newStreamId}`);
                matchPromises.push(await $.ajax({
                    "url": `${plexUrl}/library/parts/${episodePartId}?audioStreamID=${bestMatch.matchId}&allParts=1`,
                    "method": "POST",
                    "headers": {
                        "X-Plex-Token": plexToken,
                        "Accept": "application/json"
                    },
                    "success": (data) => {
                        //console.log(`Episode: ${episodeData.MediaContainer.Metadata[0].title} updated with Audio Track: ${newStreamId} because of a match on ${matchType}`);
                        $('#progressModal #modalBodyText').append(`<span><strong>${episodeData.MediaContainer.Metadata[0].title}</strong> updated with Audio Track: <strong>${bestMatch.matchId}</strong> because of a match on <strong>${matchType}</strong></span><br />`);
                        $(row).siblings().removeClass("table-active");
                        $(row).addClass("table-active");
                    },
                    "error": (data) => {
                        console.log("ERROR L406");
                        console.log(data);
                    }
                }));
            }
            else {
                //console.log(`Episode: ${episodeData.MediaContainer.Metadata[0].title} has no match, or there is only 1 audio track`);
            }
        }
        try {
            await Promise.all(matchPromises.map(p => p.catch(e => e)));
        }
        catch (e) {
            console.log("ERROR L419");
            console.log(e);
        }
        //console.log("Completed all Updates");
        $('#modalBodyText .alert').removeClass("alert-warning").addClass("alert-success");
        $("#modalBodyText #modalTitleText").text("Processing Complete!");
        $('#modalBodyText .spinner-border').css('visibility','hidden');
    }
}

async function setSubtitleStream(partsId, streamId, row) {
    let singleEpisode = $("#singleEpisode").prop("checked");

    if (singleEpisode) {
        $.ajax({
            "url": `${plexUrl}/library/parts/${partsId}?subtitleStreamID=${streamId}&allParts=1`,
            "method": "POST",
            "headers": {
                "X-Plex-Token": plexToken,
                "Accept": "application/json"
            },
            "success": (data) => {
                //console.log("success");
                $(row).siblings().removeClass("table-active");
                $(row).addClass("table-active").addClass("success-transition");
                setTimeout(() => {
                    $(row).removeClass('success-transition');
                }, 1500);
            },
            "error": (data) => {
                console.log("ERROR L449");
                console.log(data);
            }
        });
    }
    else {
        //console.log("Apply Subtitle Stream to whole series");
        // Show the modal to set progress
        $('#progressModal #progressModalTitle').empty();
        $('#progressModal #progressModalTitle').text(`Processing Subtitle Changes`);
        $('#progressModal #modalBodyText').empty();
        $('#progressModal #modalBodyText').append(`<div class="alert alert-warning" role="alert">
                <div class="d-flex align-items-center">
                    <span id="modalTitleText">Please do not close this tab or refresh until the process is complete</span>
                <div class="spinner-border text-warning ml-auto" role="status" aria-hidden="true"></div>
            </div>
        </div>`);
        $('#progressModal').modal();

        let matchPromises = []; // This will store the promises to change the audio for given files. It means we can run in parallel and await them all
        let searchTitle = ($(".title", row).text() == "undefined") ? undefined : $(".title", row).text();
        let searchName = ($(".name", row).text() == "undefined") ? undefined : $(".name", row).text();
        let searchLanguage = ($(".language", row).text() == "undefined") ? undefined : $(".language", row).text();
        let searchCode = ($(".code", row).text() == "undefined") ? undefined : $(".code", row).text();

        // We have the Seasons Ids stored in seasonsList, so iterate over them to get all the episodes
        let episodeList = [];
        for (let i = 0; i < seasonsList.length; i++) {
            let seasonEpisodes = await $.ajax({
                "url": `${plexUrl}/library/metadata/${seasonsList[i]}/children`,
                "method": "GET",
                "headers": {
                    "X-Plex-Token": plexToken,
                    "Accept": "application/json"
                }
            });
            for (let j = 0; j < seasonEpisodes.MediaContainer.Metadata.length; j++) {
                episodeList.push(seasonEpisodes.MediaContainer.Metadata[j].ratingKey);
            }
        }
        //console.log(episodeList);

        // We have the episodes in episodeList, now we need to go through each one and see what streams are available
        for (let i = 0; i < episodeList.length; i++) {
            let episodeData = await $.ajax({
                "url": `${plexUrl}/library/metadata/${episodeList[i]}`,
                "method": "GET",
                "headers": {
                    "X-Plex-Token": plexToken,
                    "Accept": "application/json"
                }
            });
            const episodePartId = episodeData.MediaContainer.Metadata[0].Media[0].Part[0].id;
            const episodeStreams = episodeData.MediaContainer.Metadata[0].Media[0].Part[0].Stream;
            //console.log(episodePartId);
            //console.log(episodeStreams);

            // If streamId = 0 then we are unsetting the subtitles. Otherwise we need to find the best matches for each episode
            if (streamId != 0) {
                // Loop through each subtitle stream and check for any matches using the searchTitle, searchName, searchLanguage, searchCode
                let hasMatch = false;
                let matchType = "";
                let potentialMatches = [];
                let selectedTrack = {
                    "matchId": "",
                    "matchLevel": 0
                };
                let bestMatch;

                for (let j = 0; j < episodeStreams.length; j++) {
                    // Subtitle streams are streamType 3, so we only care about that
                    if (episodeStreams[j].streamType == "3") {
                        // If EVERYTHING is a match, even if they are "undefined" then select it
                        if ((episodeStreams[j].title == searchTitle) && (episodeStreams[j].displayTitle == searchName) && (episodeStreams[j].language == searchLanguage) && (episodeStreams[j].languageCode == searchCode)) {
                            if (episodeStreams[j].selected == true) {
                                selectedTrack.matchId = episodeStreams[j].id;
                                selectedTrack.matchLevel = 6;
                            }
                            else {
                                potentialMatches.push({
                                    "matchId": episodeStreams[j].id,
                                    "matchLevel": 6
                                });
                            }
                        }
                        // If the displayTitle and title are the same, we have an instant match (also rule out any undefined matches)
                        else if ((episodeStreams[j].title == searchTitle) && (episodeStreams[j].displayTitle == searchName) && (episodeStreams[j].title != "undefined") && (episodeStreams[j].displayTitle != "undefined")) {
                            if (episodeStreams[j].selected == true) {
                                selectedTrack.matchId = episodeStreams[j].id;
                                selectedTrack.matchLevel = 5;
                            }
                            else {
                                potentialMatches.push({
                                    "matchId": episodeStreams[j].id,
                                    "matchLevel": 5
                                });
                            }
                        }
                        // If the titles are the same (rule out undefined match)
                        else if ((episodeStreams[j].title == searchTitle) && (episodeStreams[j].title != "undefined")) {
                            if (episodeStreams[j].selected == true) {
                                selectedTrack.matchId = episodeStreams[j].id;
                                selectedTrack.matchLevel = 4;
                            }
                            else {
                                potentialMatches.push({
                                    "matchId": episodeStreams[j].id,
                                    "matchLevel": 4
                                });
                            }
                        }
                        // If the names are the same (rule out undefined match)
                        else if ((episodeStreams[j].displayTitle == searchName) && (episodeStreams[j].displayTitle != "undefined")) {
                            if (episodeStreams[j].selected == true) {
                                selectedTrack.matchId = episodeStreams[j].id;
                                selectedTrack.matchLevel = 3;
                            }
                            else {
                                potentialMatches.push({
                                    "matchId": episodeStreams[j].id,
                                    "matchLevel": 3
                                });
                            }
                        }
                        // If the languages are the same (rule out undefined match)
                        else if ((episodeStreams[j].language == searchLanguage) && (episodeStreams[j].language != "undefined")) {
                            if (episodeStreams[j].selected == true) {
                                selectedTrack.matchId = episodeStreams[j].id;
                                selectedTrack.matchLevel = 2;
                            }
                            else {
                                potentialMatches.push({
                                    "matchId": episodeStreams[j].id,
                                    "matchLevel": 2
                                });
                            }
                        }
                        // If the language codes are the same (rule out undefined match)
                        else if ((episodeStreams[j].languageCode == searchCode) && (episodeStreams[j].languageCode != "undefined")) {
                            if (episodeStreams[j].selected == true) {
                                selectedTrack.matchId = episodeStreams[j].id;
                                selectedTrack.matchLevel = 1;
                            }
                            else {
                                potentialMatches.push({
                                    "matchId": episodeStreams[j].id,
                                    "matchLevel": 1
                                });
                            }
                        }
                    }
                }

                // If there are no potential matches, then return hasMatch = false so we can skip sending unnecessary commands to plex
                if (potentialMatches.length == 0) {
                    hasMatch = false;
                }
                else {
                    // If there are potential matches - get the highest matchLevel (most accurate) and compare it to the currently selected track
                    bestMatch = potentialMatches.reduce((p, c) => p.matchLevel > c.matchLevel ? p : c);
                    if (bestMatch.matchLevel > selectedTrack.matchLevel) {
                        // By default selectedTrack.matchLevel = 0, so even if there is no selected track, this comparison will work
                        hasMatch = true;
                        if (bestMatch.matchLevel == 6) matchType = "Everything";
                        else if (bestMatch.matchLevel == 5) matchType = "Name and Title";
                        else if (bestMatch.matchLevel == 4) matchType = "Title";
                        else if (bestMatch.matchLevel == 3) matchType = "Name";
                        else if (bestMatch.matchLevel == 2) matchType = "Language";
                        else if (bestMatch.matchLevel == 1) matchType = "Language Code";
                    }
                    else {
                        hasMatch = false;
                    }
                }

                if (hasMatch) {
                    // There is a match, so update the subtitle track using the currentMatch.matchId and episodePartId
                    //console.log(`Episode: ${episodeData.MediaContainer.Metadata[0].title} has a match on the type: ${matchType}, and will set the new Subtitle Track to: ${currentMatch.matchId}`);
                    matchPromises.push(await $.ajax({
                        "url": `${plexUrl}/library/parts/${episodePartId}?subtitleStreamID=${bestMatch.matchId}&allParts=1`,
                        "method": "POST",
                        "headers": {
                            "X-Plex-Token": plexToken,
                            "Accept": "application/json"
                        },
                        "success": (data) => {
                            //console.log(`Episode: ${episodeData.MediaContainer.Metadata[0].title} updated with Subtitle Track: ${currentMatch.matchId} because of a match on ${matchType}`);
                            $('#progressModal #modalBodyText').append(`<span><strong>${episodeData.MediaContainer.Metadata[0].title}</strong> updated with Subtitle Track: <strong>${bestMatch.matchId}</strong> because of a match on <strong>${matchType}</strong></span><br />`);
                            $(row).siblings().removeClass("table-active");
                            $(row).addClass("table-active");
                        },
                        "error": (data) => {
                            console.log("ERROR L572");
                            console.log(data);
                        }
                    }));
                }
                else {
                    //console.log(`Episode: ${episodeData.MediaContainer.Metadata[0].title} has no match, or there is only 1 subtitle track`);
                }
            }
            else {
                // streamId = 0, which means we just want to set the subtitleStreamID = 0 for every episode
                matchPromises.push(await $.ajax({
                    "url": `${plexUrl}/library/parts/${episodePartId}?subtitleStreamID=0&allParts=1`,
                    "method": "POST",
                    "headers": {
                        "X-Plex-Token": plexToken,
                        "Accept": "application/json"
                    },
                    "success": (data) => {
                        //console.log(`Episode: ${episodeData.MediaContainer.Metadata[0].title} updated with Subtitle Track: ${currentMatch.matchId} because of a match on ${matchType}`);
                        $('#progressModal #modalBodyText').append(`<span><strong>${episodeData.MediaContainer.Metadata[0].title}</strong> has had the subtitles <strong>deselected</strong></span><br />`);
                        $(row).siblings().removeClass("table-active");
                        $(row).addClass("table-active");
                    },
                    "error": (data) => {
                        console.log("ERROR L834");
                        console.log(data);
                    }
                }));
            }
        }

        try {
            await Promise.all(matchPromises.map(p => p.catch(e => e)));
        }
        catch (e) {
            console.log("ERROR 585");
            console.log(e);
        }

        //console.log("Completed all Updates");
        $('#modalBodyText .alert').removeClass("alert-warning").addClass("alert-success");
        $("#modalBodyText #modalTitleText").text("Processing Complete!");
        $('#modalBodyText .spinner-border').css('visibility','hidden');
    }
}