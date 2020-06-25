var plexUrl;
var plexToken;
var clientIdentifier; // UID for the device being used
var plexProduct = "PASTA-cglatot";
var backOffTimer = 0;
var serverList = []; // save server information for pin login and multiple servers

var libraryNumber = ""; // The Library ID that was clicked
var showId = ""; // Stores the Id for the most recently clicked series
var seasonsList = []; // Stores the Ids for all seasons of the most recently clicked series
var seasonId = ""; // Store the Id of the most recently clicked season
var episodeId = ""; // Stores the Id of the most recently clicked episode

$(document).ready(() => {
    // Check if there is a page refresh, if so we want to push the history without the #
    let navigationType = performance.getEntriesByType("navigation")[0].type;
    if ((navigationType == 'reload') && (window.location.href.indexOf('#authentication') == -1)) {
        window.history.pushState('', document.title, window.location.pathname + '#authentication');
    }

    // Enable Tooltips
    $('#helpAboutIcon, #titleLogo').tooltip();

    // Enable history tracking for tabs
    $('a[data-toggle="tab"]').historyTabs();

    // Check if the page was loaded locally or over http and warn them about the value of https
    if ((location.protocol == "http:") || (location.protocol == "file:")) {
        if (localStorage.showHttpAlert == 'false') {

        }
        else {
            $("#insecureWarning").show();
        }
    }

    // Validation listeners on the Plex URL Input
    $('#plexUrl').on("input", () => {
        validateEnableConnectBtn('plexUrl');
    });

    // Validation listeners on the Plex Token Input
    $('#plexToken').on("input", () => {
        validateEnableConnectBtn('plexToken');
    });

    // Setup on change listener for toggle buttons
    $('input[type=radio][name=pinOrAuth]').change(function() {
        toggleAuthPages(this.value);
    });

    // Set the clientID, this might get overridden if one is saved to localstorage
    clientIdentifier = `PASTA-cglatot-${Date.now()}-${Math.round(Math.random() * 1000)}`;

    if (!localStorage.isPinAuth) {
        // Not using PIN auth, so must be using url / token
        if (localStorage.plexUrl && localStorage.plexUrl !== "") {
            plexUrl = localStorage.plexUrl;
            $('#plexUrl').val(localStorage.plexUrl);
            validateEnableConnectBtn('plexUrl');
            $('#forgetDivider, #forgetDetailsSection').show();
        }
        if (localStorage.plexToken && localStorage.plexToken !== "") {
            plexToken = localStorage.plexToken;
            $('#plexToken').val(localStorage.plexToken);
            validateEnableConnectBtn('plexToken');
            $('#forgetDivider, #forgetDetailsSection').show();
        }

        // Display a PIN code for that authentication as well
        $.ajax({
            "url": `https://plex.tv/pins.xml?X-Plex-Product=${plexProduct}&X-Plex-Client-Identifier=${clientIdentifier}`,
            "method": "POST",
            "success": (data) => {
                let pinId = $(data).find('id')[0].innerHTML;
                let pinCode = $(data).find('code')[0].innerHTML;
    
                $('#pin-code-holder').html(pinCode);
                backOffTimer = Date.now();
                listenForValidPincode(pinId);
            },
            "error": (data) => {
                console.log("ERROR L59");
                console.log(data);
            }
        });
    } else {
        $('#new-pin-container').hide();
        $('#authed-pin-container').show();
        // We are using Pin Auth
        clientIdentifier = localStorage.clientIdentifier;
        plexToken = localStorage.pinAuthToken;
        getServers();
    }
});

function toggleAuthPages(value) {
    if (value == 'showPinControls') {
        $('#pin-auth-over-container').show();
        $('#url-auth-over-container').hide();
    } else {
        $('#pin-auth-over-container').hide();
        $('#url-auth-over-container').show();

        if (localStorage.isPinAuth) {
            $("#authWarningText").html(`<div class="alert alert-warning alert-dismissible fade show mt-3" role="alert">
                        <strong>Warning:</strong> You are currently signed in via PIN. Please <a href="javascript:void(0)" onclick="forgetPinDetails()">sign out of PIN</a> before proceeding to connect using a URL / IP address.
                        <button type="button" class="close" data-dismiss="alert" aria-label="Close">
                            <span aria-hidden="true">&times;</span>
                        </button>
                    </div>`);
        }
    }
}

function listenForValidPincode (pinId) {
    let currentTime = Date.now();
    if ((currentTime - backOffTimer)/1000 < 180) {
        $.ajax({
            "url": `https://plex.tv/pins/${pinId}?X-Plex-Product=${plexProduct}&X-Plex-Client-Identifier=${clientIdentifier}`,
            "method": "GET",
            "success": (data) => {
                if (data.pin.auth_token != null) {
                    plexToken = data.pin.auth_token;
                    // Save to local storage
                    localStorage.isPinAuth = true;
                    localStorage.pinAuthToken = plexToken;
                    localStorage.clientIdentifier = clientIdentifier;
                    $('#new-pin-container').hide();
                    $('#authed-pin-container').show();
                    getServers();
                } else {
                    setTimeout(() => {
                        listenForValidPincode(pinId);
                    }, 5000);
                }
            },
            "error": (data) => {
                console.log("ERROR L73");
                console.log(data);
                return;
            }
        });
    } else {
        $('#new-pin-container').html(' <p><i class="far fa-times-circle mr-2" style="color: #e5a00d; font-size: 1.5em; vertical-align: middle;"></i>PIN entry timed out. \
        Please <a href="javascript:void(0)" onclick="window.location.reload()">refresh the page</a> to get a new PIN.</p>');
    }
}

function getServers () {
    $.ajax({
        "url": `https://plex.tv/pms/servers.xml?X-Plex-Product=${plexProduct}&X-Plex-Client-Identifier=${clientIdentifier}`,
        "method": "GET",
        "headers": {
            "X-Plex-Token": plexToken
        },
        "success": (data) => {
            let servers = $(data).find('Server');
            if (servers.length > 1) {
                displayServers(servers);
                // Add server info to the list
                for (let i = 0; i < servers.length; i++) {
                    serverList.push({
                        name: $(servers[i]).attr("name"),
                        accessToken: $(servers[i]).attr("accessToken"),
                        address: $(servers[i]).attr("address"),
                        port: $(servers[i]).attr("port")
                    });
                }
            } else {
                plexToken = $(servers[0]).attr("accessToken");
                plexUrl = `http://${$(servers[0]).attr("address")}:${$(servers[0]).attr("port")}`;
                connectToPlex();
            }
        },
        "error": (data) => {
            console.log("ERROR L59");
            console.log(data);
        }
    });
}

function displayServers(servers) {
    $("#serverTable tbody").empty();
    $("#libraryTable tbody").empty();
    $("#tvShowsTable tbody").empty();
    $("#seasonsTable tbody").empty();
    $("#episodesTable tbody").empty();
    $("#audioTable tbody").empty();
    $("#subtitleTable tbody").empty();

    for (let i = 0; i < servers.length; i++) {
        let rowHTML = `<tr onclick="chooseServer(${i}, this)">
                        <td>${$(servers[i]).attr("name")}</td>
                    </tr>`;
        $("#serverTable tbody").append(rowHTML);
    }
    $("#serverTableContainer").show();
}

function chooseServer(number, row) {
    $("#libraryTable tbody").empty();
    $("#tvShowsTable tbody").empty();
    $("#seasonsTable tbody").empty();
    $("#episodesTable tbody").empty();
    $("#audioTable tbody").empty();
    $("#subtitleTable tbody").empty();

    $(row).siblings().removeClass("table-active");
    $(row).addClass("table-active");

    plexToken = serverList[number].accessToken;
    plexUrl = `http://${serverList[number].address}:${serverList[number].port}`;
    connectToPlex();
}

function validateEnableConnectBtn(context) {
    // Apply validation highlighting to URL field
    if (context == 'plexUrl') {
        if ($('#plexUrl').val() != "") {
            $('#plexUrl').removeClass("is-invalid").addClass("is-valid");
        }
        else {
            $('#plexUrl').removeClass("is-valid").addClass("is-invalid");
        }
    }
    else {
        // Apply validation highlighting to Plex Token field
        if ($('#plexToken').val() != "") {
            $('#plexToken').removeClass("is-invalid").addClass("is-valid");
        }
        else {
            $('#plexToken').removeClass("is-valid").addClass("is-invalid");
        }
    }

    // Enable or disable the button, depending on field status
    if (($('#plexUrl').val() != "") && ($('#plexToken').val() != "")) {
        $("#btnConnectToPlex").prop("disabled", false);
    }
    else {
        $("#btnConnectToPlex").prop("disabled", true);
    }
}

function forgetDetails() {
    localStorage.removeItem('plexUrl');
    localStorage.removeItem('plexToken');
    $('#plexUrl, #plexToken').val('').removeClass('is-valid is-invalid');
    $('#confirmForget').fadeIn(250).delay(750).fadeOut(1250, () => {
        $('#forgetDivider, #forgetDetailsSection').hide();
    });
}

function forgetPinDetails() {
    localStorage.removeItem('isPinAuth');
    localStorage.removeItem('pinAuthToken');
    localStorage.removeItem('clientIdentifier');
    window.location.reload();
}

function hideAlertForever() {
    $("#insecureWarning").hide();
    localStorage.showHttpAlert = 'false';
}

function connectToPlex() {
    plexUrl = plexUrl || $("#plexUrl").val().trim().replace(/\/+$/, '');
    plexToken = plexToken || $("#plexToken").val().trim();

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
            if ($('#rememberDetails').prop('checked')) {
                localStorage.plexUrl = plexUrl;
                localStorage.plexToken = plexToken;
                $('#forgetDivider, #forgetDetailsSection').show();
            }
            displayLibraries(data);
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
            else if ((location.protocol == 'https:') && (plexUrl.indexOf('http:') > -1)) {
                console.log("Trying to use http over a https site");
                $("#authWarningText").html(`<div class="alert alert-warning alert-dismissible fade show mt-3" role="alert">
                        <strong>Warning:</strong> Error - You are trying to access a http server via the site in https. Please access your server via https, or load this site \
                        over http by <a href="http://www.pastatool.com">clicking here</a>.
                        <button type="button" class="close" data-dismiss="alert" aria-label="Close">
                            <span aria-hidden="true">&times;</span>
                        </button>
                    </div>`);
            }
            else {
                console.log("Unknown error, most likely bad URL / IP");
                $("#authWarningText").html(`<div class="alert alert-warning alert-dismissible fade show mt-3" role="alert">
                        <strong>Warning:</strong> Unknown Error (0) - This is usually caused by a wrong URL. Please verify the URL and try again.
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
    // Need these 2 variables and function for progress bar
    let currentProgress = 0;
    let maxProgress = 0;

    if (singleEpisode) {
        $.ajax({
            "url": `${plexUrl}/library/parts/${partsId}?audioStreamID=${streamId}&allParts=1`,
            "method": "POST",
            "headers": {
                "X-Plex-Token": plexToken,
                "Accept": "application/json"
            },
            "success": (data) => {
                $(row).siblings().removeClass("table-active");
                $(row).addClass("table-active").addClass("success-transition");
                setTimeout(() => {
                    $(row).removeClass('success-transition');
                }, 1750);
            },
            "error": (data) => {
                console.log("ERROR L283");
                console.log(data);
            }
        });
    }
    else {
        // Show the modal to set progress
        $('#progressModal #progressModalTitle').empty();
        $('#progressModal #progressModalTitle').text(`Processing Audio Changes`);
        $('#progressModal #modalBodyText').empty();
        $('#progressModal #modalBodyText').append(`<div class="alert alert-warning" role="alert">
                <div class="d-flex align-items-center">
                    <span id="modalTitleText">Please do not close this tab or refresh until the process is complete</span>
            </div>
            <div class="progress" id="progressBarContainer">
                <div id="progressBar" class="progress-bar progress-bar-striped progress-bar-animated bg-warning" role="progressbar" style="width: 0%" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100"></div>
            </div>
        </div>`);
        $('#progressModal').modal();

        let promiseConstructors = []; // This will hold the details that will then be added to the full promises in matchPromises
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
            const seasonNumber = episodeData.MediaContainer.Metadata[0].parentIndex;
            const episodeNumber = episodeData.MediaContainer.Metadata[0].index;
            const episodePartId = episodeData.MediaContainer.Metadata[0].Media[0].Part[0].id;
            const episodeStreams = episodeData.MediaContainer.Metadata[0].Media[0].Part[0].Stream;

            // Loop through each audio stream and check for any matches using the searchTitle, searchName, searchLanguage, searchCode
            let hasMatch = false;
            let matchType = "";
            let potentialMatches = [];
            let selectedTrack = {
                "matchId": "",
                "matchLevel": 0,
                "matchName": ""
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
                            selectedTrack.matchName = episodeStreams[j].displayTitle;
                        }
                        else {
                            potentialMatches.push({
                                "matchId": episodeStreams[j].id,
                                "matchLevel": 6,
                                "matchName": episodeStreams[j].displayTitle
                            });
                        }
                    }
                    // If the displayTitle and title are the same, we have an instant match (also rule out any undefined matches)
                    else if ((episodeStreams[j].title == searchTitle) && (episodeStreams[j].displayTitle == searchName) && (episodeStreams[j].title != "undefined") && (episodeStreams[j].displayTitle != "undefined")) {
                        if (episodeStreams[j].selected == true) {
                            selectedTrack.matchId = episodeStreams[j].id;
                            selectedTrack.matchLevel = 5;
                            selectedTrack.matchName = episodeStreams[j].displayTitle;
                        }
                        else {
                            potentialMatches.push({
                                "matchId": episodeStreams[j].id,
                                "matchLevel": 5,
                                "matchName": episodeStreams[j].displayTitle
                            });
                        }
                    }
                    // If the titles are the same (rule out undefined match)
                    else if ((episodeStreams[j].title == searchTitle) && (episodeStreams[j].title != "undefined")) {
                        if (episodeStreams[j].selected == true) {
                            selectedTrack.matchId = episodeStreams[j].id;
                            selectedTrack.matchLevel = 4;
                            selectedTrack.matchName = episodeStreams[j].displayTitle;
                        }
                        else {
                            potentialMatches.push({
                                "matchId": episodeStreams[j].id,
                                "matchLevel": 4,
                                "matchName": episodeStreams[j].displayTitle
                            });
                        }
                    }
                    // If the names are the same (rule out undefined match)
                    else if ((episodeStreams[j].displayTitle == searchName) && (episodeStreams[j].displayTitle != "undefined")) {
                        if (episodeStreams[j].selected == true) {
                            selectedTrack.matchId = episodeStreams[j].id;
                            selectedTrack.matchLevel = 3;
                            selectedTrack.matchName = episodeStreams[j].displayTitle;
                        }
                        else {
                            potentialMatches.push({
                                "matchId": episodeStreams[j].id,
                                "matchLevel": 3,
                                "matchName": episodeStreams[j].displayTitle
                            });
                        }
                    }
                    // If the languages are the same (rule out undefined match)
                    else if ((episodeStreams[j].language == searchLanguage) && (episodeStreams[j].language != "undefined")) {
                        if (episodeStreams[j].selected == true) {
                            selectedTrack.matchId = episodeStreams[j].id;
                            selectedTrack.matchLevel = 2;
                            selectedTrack.matchName = episodeStreams[j].displayTitle;
                        }
                        else {
                            potentialMatches.push({
                                "matchId": episodeStreams[j].id,
                                "matchLevel": 2,
                                "matchName": episodeStreams[j].displayTitle
                            });
                        }
                    }
                    // If the language codes are the same (rule out undefined match)
                    else if ((episodeStreams[j].languageCode == searchCode) && (episodeStreams[j].languageCode != "undefined")) {
                        if (episodeStreams[j].selected == true) {
                            selectedTrack.matchId = episodeStreams[j].id;
                            selectedTrack.matchLevel = 1;
                            selectedTrack.matchName = episodeStreams[j].displayTitle;
                        }
                        else {
                            potentialMatches.push({
                                "matchId": episodeStreams[j].id,
                                "matchLevel": 1,
                                "matchName": episodeStreams[j].displayTitle
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
                promiseConstructors.push({
                    "url": `${plexUrl}/library/parts/${episodePartId}?audioStreamID=${bestMatch.matchId}&allParts=1`,
                    "messageAppend": `<span><strong>S${seasonNumber}E${episodeNumber} - ${episodeData.MediaContainer.Metadata[0].title}</strong> updated with Audio Track: <strong>${bestMatch.matchName}</strong> because of a match on <strong>${matchType}</strong></span><br />`
                });
            }
            else {
                //console.log(`Episode: ${episodeData.MediaContainer.Metadata[0].title} has no match, or there is only 1 audio track`);
            }
        }

        // Update the progress bar
        maxProgress = promiseConstructors.length;
        $('#progressBar').attr('aria-valuemax', maxProgress);

        function futurePromise(data) {
            return axios({
                "url": data.url,
                "method": "POST",
                "headers": {
                    "X-Plex-Token": plexToken,
                    "Accept": "application/json"
                }
            }).then((result) => {
                $('#progressModal #modalBodyText').append(data.messageAppend);
                $(row).siblings().removeClass("table-active");
                $(row).addClass("table-active");
                handleProgress();
            }).catch((e) => console.log(e));
        }

        for (let k = 0; k < promiseConstructors.length; k++) {
            let axiosPromise = futurePromise(promiseConstructors[k]);
            matchPromises.push(axiosPromise);
        }

        function handleProgress() {
            currentProgress++;
            const calculatedWidth = (currentProgress / maxProgress) * 100;
            $('#progressBar').width(`${calculatedWidth}%`);
            $('#progressBar').attr('aria-valuenow', currentProgress);
        };

        try {
            Promise.allSettled(matchPromises).then(() => {
                $('#modalBodyText .alert').removeClass("alert-warning").addClass("alert-success");
                $("#modalBodyText #modalTitleText").text("Processing Complete!");
                $('#modalBodyText #progressBarContainer').hide();
            });
        }
        catch (e) {
            console.log("ERROR L419");
            console.log(e);
        }
    }
}

async function setSubtitleStream(partsId, streamId, row) {
    let singleEpisode = $("#singleEpisode").prop("checked");
    // Need these 2 variables and function for progress bar
    let currentProgress = 0;
    let maxProgress = 0;

    if (singleEpisode) {
        $.ajax({
            "url": `${plexUrl}/library/parts/${partsId}?subtitleStreamID=${streamId}&allParts=1`,
            "method": "POST",
            "headers": {
                "X-Plex-Token": plexToken,
                "Accept": "application/json"
            },
            "success": (data) => {
                $(row).siblings().removeClass("table-active");
                $(row).addClass("table-active").addClass("success-transition");
                setTimeout(() => {
                    $(row).removeClass('success-transition');
                }, 1750);
            },
            "error": (data) => {
                console.log("ERROR L449");
                console.log(data);
            }
        });
    }
    else {
        // Show the modal to set progress
        $('#progressModal #progressModalTitle').empty();
        $('#progressModal #progressModalTitle').text(`Processing Subtitle Changes`);
        $('#progressModal #modalBodyText').empty();
        $('#progressModal #modalBodyText').append(`<div class="alert alert-warning" role="alert">
                <div class="d-flex align-items-center">
                    <span id="modalTitleText">Please do not close this tab or refresh until the process is complete</span>
            </div>
            <div class="progress" id="progressBarContainer">
                <div id="progressBar" class="progress-bar progress-bar-striped progress-bar-animated bg-warning" role="progressbar" style="width: 0%" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100"></div>
            </div>
        </div>`);
        $('#progressModal').modal();

        let promiseConstructors = []; // This will hold the details that will then be added to the full promises in matchPromises
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
            const seasonNumber = episodeData.MediaContainer.Metadata[0].parentIndex;
            const episodeNumber = episodeData.MediaContainer.Metadata[0].index;
            const episodePartId = episodeData.MediaContainer.Metadata[0].Media[0].Part[0].id;
            const episodeStreams = episodeData.MediaContainer.Metadata[0].Media[0].Part[0].Stream;

            // If streamId = 0 then we are unsetting the subtitles. Otherwise we need to find the best matches for each episode
            if (streamId != 0) {
                // Loop through each subtitle stream and check for any matches using the searchTitle, searchName, searchLanguage, searchCode
                let hasMatch = false;
                let matchType = "";
                let potentialMatches = [];
                let selectedTrack = {
                    "matchId": "",
                    "matchLevel": 0,
                    "matchName": ""
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
                                selectedTrack.matchName = episodeStreams[j].displayTitle;
                            }
                            else {
                                potentialMatches.push({
                                    "matchId": episodeStreams[j].id,
                                    "matchLevel": 6,
                                    "matchName": episodeStreams[j].displayTitle
                                });
                            }
                        }
                        // If the displayTitle and title are the same, we have an instant match (also rule out any undefined matches)
                        else if ((episodeStreams[j].title == searchTitle) && (episodeStreams[j].displayTitle == searchName) && (episodeStreams[j].title != "undefined") && (episodeStreams[j].displayTitle != "undefined")) {
                            if (episodeStreams[j].selected == true) {
                                selectedTrack.matchId = episodeStreams[j].id;
                                selectedTrack.matchLevel = 5;
                                selectedTrack.matchName = episodeStreams[j].displayTitle;
                            }
                            else {
                                potentialMatches.push({
                                    "matchId": episodeStreams[j].id,
                                    "matchLevel": 5,
                                    "matchName": episodeStreams[j].displayTitle
                                });
                            }
                        }
                        // If the titles are the same (rule out undefined match)
                        else if ((episodeStreams[j].title == searchTitle) && (episodeStreams[j].title != "undefined")) {
                            if (episodeStreams[j].selected == true) {
                                selectedTrack.matchId = episodeStreams[j].id;
                                selectedTrack.matchLevel = 4;
                                selectedTrack.matchName = episodeStreams[j].displayTitle;
                            }
                            else {
                                potentialMatches.push({
                                    "matchId": episodeStreams[j].id,
                                    "matchLevel": 4,
                                    "matchName": episodeStreams[j].displayTitle
                                });
                            }
                        }
                        // If the names are the same (rule out undefined match)
                        else if ((episodeStreams[j].displayTitle == searchName) && (episodeStreams[j].displayTitle != "undefined")) {
                            if (episodeStreams[j].selected == true) {
                                selectedTrack.matchId = episodeStreams[j].id;
                                selectedTrack.matchLevel = 3;
                                selectedTrack.matchName = episodeStreams[j].displayTitle;
                            }
                            else {
                                potentialMatches.push({
                                    "matchId": episodeStreams[j].id,
                                    "matchLevel": 3,
                                    "matchName": episodeStreams[j].displayTitle
                                });
                            }
                        }
                        // If the languages are the same (rule out undefined match)
                        else if ((episodeStreams[j].language == searchLanguage) && (episodeStreams[j].language != "undefined")) {
                            if (episodeStreams[j].selected == true) {
                                selectedTrack.matchId = episodeStreams[j].id;
                                selectedTrack.matchLevel = 2;
                                selectedTrack.matchName = episodeStreams[j].displayTitle;
                            }
                            else {
                                potentialMatches.push({
                                    "matchId": episodeStreams[j].id,
                                    "matchLevel": 2,
                                    "matchName": episodeStreams[j].displayTitle
                                });
                            }
                        }
                        // If the language codes are the same (rule out undefined match)
                        else if ((episodeStreams[j].languageCode == searchCode) && (episodeStreams[j].languageCode != "undefined")) {
                            if (episodeStreams[j].selected == true) {
                                selectedTrack.matchId = episodeStreams[j].id;
                                selectedTrack.matchLevel = 1;
                                selectedTrack.matchName = episodeStreams[j].displayTitle;
                            }
                            else {
                                potentialMatches.push({
                                    "matchId": episodeStreams[j].id,
                                    "matchLevel": 1,
                                    "matchName": episodeStreams[j].displayTitle
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
                    promiseConstructors.push({
                        "url": `${plexUrl}/library/parts/${episodePartId}?subtitleStreamID=${bestMatch.matchId}&allParts=1`,
                        "messageAppend": `<span><strong>S${seasonNumber}E${episodeNumber} - ${episodeData.MediaContainer.Metadata[0].title}</strong> updated with Subtitle Track: <strong>${bestMatch.matchName}</strong> because of a match on <strong>${matchType}</strong></span><br />`
                    });
                }
                else {
                    //console.log(`Episode: ${episodeData.MediaContainer.Metadata[0].title} has no match, or there is only 1 subtitle track`);
                }
            }
            else {
                // streamId = 0, which means we just want to set the subtitleStreamID = 0 for every episode
                promiseConstructors.push({
                    "url": `${plexUrl}/library/parts/${episodePartId}?subtitleStreamID=0&allParts=1`,
                    "messageAppend": `<span><strong>S${seasonNumber}E${episodeNumber} - ${episodeData.MediaContainer.Metadata[0].title}</strong> has had the subtitles <strong>deselected</strong></span><br />`
                });
            }
        }

        // Update the progress bar
        maxProgress = promiseConstructors.length;
        $('#progressBar').attr('aria-valuemax', maxProgress);

        function futurePromise(data) {
            return axios({
                "url": data.url,
                "method": "POST",
                "headers": {
                    "X-Plex-Token": plexToken,
                    "Accept": "application/json"
                }
            }).then((result) => {
                $('#progressModal #modalBodyText').append(data.messageAppend);
                $(row).siblings().removeClass("table-active");
                $(row).addClass("table-active");
                handleProgress();
            }).catch((e) => console.log(e));
        } 

        for (let k = 0; k < promiseConstructors.length; k++) {
            let axiosPromise = futurePromise(promiseConstructors[k]);
            matchPromises.push(axiosPromise);
        }

        function handleProgress() {
            currentProgress++;
            const calculatedWidth = (currentProgress / maxProgress) * 100;
            $('#progressBar').width(`${calculatedWidth}%`);
            $('#progressBar').attr('aria-valuenow', currentProgress);
        };

        try {
            Promise.allSettled(matchPromises).then(() => {
                $('#modalBodyText .alert').removeClass("alert-warning").addClass("alert-success");
                $("#modalBodyText #modalTitleText").text("Processing Complete!");
                $('#modalBodyText #progressBarContainer').hide();
            });
        }
        catch (e) {
                console.log("ERROR L419");
                console.log(e);
        }
    }
}
