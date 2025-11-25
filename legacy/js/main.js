// Variables for the Authorised Devices card
var clientIdentifier; // UID for the device being used
var plexProduct = "PASTA"; // X-Plex-Product - Application name
var pastaVersion = "1.6.0"; // X-Plex-Version - Application version
var pastaPlatform; // X-Plex-Platform - Web Browser
var pastaPlatformVersion; // X-Plex-Platform-Version - Web Browser version
var deviceInfo; // X-Plex-Device - Operation system?
var deviceName; // X-Plex-Device-Name - Main name shown
// End auth devices card variables
var plexUrl;
var plexToken;
var plexAdminToken;
var backOffTimer = 0;
var serverList = []; // save server information for pin login and multiple servers
var machineIdentifier = ""; // Stores the machine identifier of the connected Plex server

var libraryNumber = ""; // The Library ID that was clicked
var showId = ""; // Stores the Id for the most recently clicked series
var seasonsList = []; // Stores the Ids for all seasons of the most recently clicked series
var seasonId = ""; // Store the Id of the most recently clicked season
var episodeId = ""; // Stores the Id of the most recently clicked episode
var libraryType = "shows"; // Sets whether the library is a show or a movie / other videos

$(document).ready(() => {
    // Check if there is a page refresh, if so we want to push the history without the #
    let navigationType;
    if (window.performance && window.performance.getEntriesByType('navigation').length) {
        navigationType = window.performance.getEntriesByType("navigation")[0].type;
    } else if (performance.getEntriesByType('navigation').length) {
        navigationType = performance.getEntriesByType("navigation")[0].type;
    }
    else {
        console.log("Couldn't find the window.performance or performance to get reload information");
    }
    if ((navigationType == 'reload') && (window.location.href.indexOf('#authentication') == -1)) {
        window.history.pushState('', document.title, window.location.pathname + '#authentication');
    }

    // Enable Tooltips
    $('.helpButtons, #titleLogo').tooltip();
    // Enable history tracking for tabs
    $('a[data-toggle="tab"]').historyTabs();
    // Enable Toasts
    $('.toast').toast({'delay': 1750});

    // Check if the page was loaded locally or over http and warn them about the value of https
    if ((location.protocol == "http:") || (location.protocol == "file:")) {
        if (localStorage.showHttpAlert == 'false') {}
        else {
            $("#insecureWarning").show();
        }
    }

    // Check if they have permanently dismissed the Login Info alert
    if (localStorage.showLoginInfoAlert == 'false') {}
    else {
        $("#loginInfoAlert").show();
    }

    // Override the close mechanism to not show the loginInfoAlert
    $("#loginInfoAlertClose").on("click", () => {
        hideLoginInfoAlertForever();
    });

    // SET THE VARIABLES FOR PLEX PIN AUTH REQUESTS
    try {
        let browserInfo = getBrowser();
        // Set the clientID, this might get overridden if one is saved to localstorage
        clientIdentifier = localStorage.clientIdentifier || `PASTA-cglatot-${Date.now()}-${Math.round(Math.random() * 1000)}`;
        // Set the OS
        deviceInfo = browserInfo.os || "";
        // Set the web browser and version
        pastaPlatform = browserInfo.browser || "";
        pastaPlatformVersion = browserInfo.browserVersion || "";
        // Set the main display name
        deviceName = `PASTA (${pastaPlatform})` || "PASTA";
    } catch (e) {
        console.log(e);
        // Fallback values
        // Set the clientID, this might get overridden if one is saved to localstorage
        clientIdentifier = localStorage.clientIdentifier || `PASTA-cglatot-${Date.now()}-${Math.round(Math.random() * 1000)}`;
        // Set the OS
        deviceInfo = "";
        // Set the web browser and version
        pastaPlatform = "";
        pastaPlatformVersion = "";
        // Set the main display name
        deviceName = "PASTA";
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

    // Check whether they want to connect using a local IP or not
    if (localStorage.useLocalAddress == "true") {
        $('#connectViaLocalAddress').prop('checked', true);
    } else {
        $('#connectViaLocalAddress').prop('checked', false);
    }

    // Check if there is a stored Auth Token
    if (localStorage.pinAuthToken) {
        checkIfAuthTokenIsValid();
    } else {
        $('#new-pin-container').show();
    }

    // Check if the user saved Plex URL and Token previously
    if (localStorage.plexUrl && localStorage.plexToken) {
        plexUrl = localStorage.plexUrl;
        plexToken = localStorage.plexToken;
        $('input[type=radio][name=pinOrAuth][value="showPinControls"]').prop('checked', false);
        $('input[type=radio][name=pinOrAuth][value="showUrlControls"]').prop('checked', true);
        $('input[type=radio][name=pinOrAuth][value="showPinControls"]').closest('label').removeClass('active');
        $('input[type=radio][name=pinOrAuth][value="showUrlControls"]').closest('label').addClass('active');
        toggleAuthPages('showUrlControls');
        $('#loginWithPlexBtn').prop('disabled', true);
        $('#plexUrl').val(plexUrl);
        $('#plexToken').val(plexToken);
        $('#rememberDetails').prop('checked', true);
        connectToPlex();
    }
});

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
    $('#rememberDetails').prop('checked', false);
    $('#plexUrl, #plexToken, #rememberDetails').prop('disabled', false);
    $('#plexUrl, #plexToken').val('').removeClass('is-valid is-invalid');
    $('#confirmForget').fadeIn(250).delay(750).fadeOut(1250, () => {
        $('#forgetDivider, #forgetDetailsSection').hide();
    });
    window.location.reload();
}

function forgetPinDetails() {
    localStorage.removeItem('isPinAuth');
    localStorage.removeItem('pinAuthToken');
    localStorage.removeItem('useLocalAddress');
    window.location.reload();
}

function hideAlertForever() {
    $("#insecureWarning").hide();
    localStorage.showHttpAlert = 'false';
}

function hideLoginInfoAlertForever() {
    $("#loginInfoAlert").hide();
    localStorage.showLoginInfoAlert = 'false';
}

// Checks if the generated token is valid
function checkIfAuthTokenIsValid() {
    $.ajax({
        "url": `https://plex.tv/api/v2/user`,
        "headers": {
            "accept": "application/json",
            "X-Plex-Client-Identifier": clientIdentifier,
            "X-Plex-Token": localStorage.pinAuthToken,
            "X-Plex-Product": plexProduct,
            "X-Plex-Version": pastaVersion,
            "X-Plex-Platform": pastaPlatform,
            "X-Plex-Platform-Version": pastaPlatformVersion,
            "X-Plex-Device": deviceInfo,
            "X-Plex-Device-Name": deviceName
        },
        "method": "GET",
        "success": (data) => {
            plexToken = localStorage.pinAuthToken;
            $('#new-pin-container').hide();
            $('#authed-pin-container').show();
            $('#loggedInAs').text(data.username);
            getServers();
        },
        "error": (data) => {
            if (data.status == 401) {
                // Auth Token has expired
                localStorage.removeItem('isPinAuth');
                localStorage.removeItem('pinAuthToken');
                localStorage.removeItem('useLocalAddress');
                $('#new-pin-container').show();
            } else {
                console.log("ERROR L121");
            }
        }
    });
}

function authenticateWithPlex() {
    // Generate a PIN code to get the URL
    $.ajax({
        "url": `https://plex.tv/api/v2/pins`,
        "headers": {
            "accept": "application/json",
            "strong": "true",
            "X-Plex-Client-Identifier": clientIdentifier,
            "X-Plex-Product": plexProduct,
            "X-Plex-Version": pastaVersion,
            "X-Plex-Platform": pastaPlatform,
            "X-Plex-Platform-Version": pastaPlatformVersion,
            "X-Plex-Device": deviceInfo,
            "X-Plex-Device-Name": deviceName
        },
        "method": "POST",
        "success": (data) => {
            // For some reason auth doesn't work unless you choose Plex Web as the product id
            let plexProductTemp = encodeURIComponent("Plex Web");
            let authAppUrl = `https://app.plex.tv/auth#?clientID=${clientIdentifier}&code=${data.code}&context%5Bdevice%5D%5Bproduct%5D=${plexProductTemp}`;

            $('#waitOnPinAuth').show();
            $('#loginWithPlexBtn').hide();
            let popupWindow = window.open(authAppUrl, 'PlexSignIn', 'width=800,height=730');
            backOffTimer = Date.now();
            listenForValidPincode(data.id, clientIdentifier, data.code, popupWindow);
        },
        "error": (data) => {
            console.log("ERROR L121");
            console.log(data);
        }
    });
}

function listenForValidPincode(pinId, clientId, pinCode, popWindow) {
    let currentTime = Date.now();
    if ((currentTime - backOffTimer)/1000 < 180) {
        $.ajax({
            "url": `https://plex.tv/api/v2/pins/${pinId}`,
            "headers": {
                "accept": "application/json",
                "code": pinCode,
                "X-Plex-Client-Identifier": clientId,
            },
            "method": "GET",
            "success": (data) => {
                if (data.authToken != null) {
                    $('#waitOnPinAuth').hide();
                    localStorage.clientIdentifier = clientIdentifier;
                    localStorage.isPinAuth = true;
                    localStorage.pinAuthToken = data.authToken;
                    plexToken = data.authToken;
                    checkIfAuthTokenIsValid();
                    popWindow.close();
                } else {
                    setTimeout(() => {
                        listenForValidPincode(pinId, clientId, pinCode, popWindow);
                    }, 3000); // Check every 3 seconds
                }
            },
            "error": (data) => {
                console.log("ERROR L121");
                console.log(data);
            }
        });
    } else {
        $('#new-pin-container').html(' <p><i class="far fa-times-circle mr-2" style="color: #e5a00d; font-size: 1.5em; vertical-align: middle;"></i>Login timed out. \
        Please <a href="javascript:void(0)" onclick="window.location.reload()">refresh the page</a> and ensure your popup blocker is disabled.</p>');
    }
}

// Toggle between the authentication methods
function toggleAuthPages(value) {
    if (value == 'showPinControls') {
        $('#pin-auth-over-container, #serverTableContainer, #userTableContainer').show();
        $('#url-auth-over-container').hide();

        if (localStorage.plexUrl && localStorage.plexToken) {
            $("#authTokenWarningText").html(`<div class="alert alert-warning alert-dismissible fade show mt-3" role="alert">
                        <strong>Warning:</strong> You are currently connected to a server via URL/Token. Please <a href="javascript:void(0)" onclick="forgetDetails()">disconnect</a> before proceeding to connect using Plex sign in.
                        <button type="button" class="close" data-dismiss="alert" aria-label="Close">
                            <span aria-hidden="true">&times;</span>
                        </button>
                    </div>`);
        }
    } else {
        $('#pin-auth-over-container, #serverTableContainer, #userTableContainer').hide();
        $('#url-auth-over-container').show();

        if (localStorage.isPinAuth) {
            $("#authWarningText").html(`<div class="alert alert-warning alert-dismissible fade show mt-3" role="alert">
                        <strong>Warning:</strong> You are currently signed in via Plex. Please <a href="javascript:void(0)" onclick="forgetPinDetails()">sign out of Plex</a> before proceeding to connect using a URL / IP address.
                        <button type="button" class="close" data-dismiss="alert" aria-label="Close">
                            <span aria-hidden="true">&times;</span>
                        </button>
                    </div>`);
        }
    }
}

// Called when the "connect using local IP" checkbox is toggled
// Refreshes the page and updates the variable for whether it should use the local address or not
function useLocalAddress (checkbox) {
    if (checkbox.checked) {
        localStorage.useLocalAddress = "true";
    } else {
        localStorage.removeItem('useLocalAddress');
    }
    window.location.reload();
}

function getServers () {
    // Choose whether or not to include https connections
    let includeHttps = 1;
    if (location.protocol == 'http:') {
        includeHttps = 0;
    }

    // Get the servers for this user
    $.ajax({
        "url": `https://plex.tv/api/v2/resources?includeHttps=${includeHttps}&includeRelay=0`,
        "method": "GET",
        "headers": {
            "X-Plex-Client-Identifier": clientIdentifier,
            "X-Plex-Token": plexToken,
            "accept": "application/json"
        },
        "success": (data) => {
            let servers = data.filter(entry => entry.product == "Plex Media Server");
            if (servers.length > 0) {
                // Add server info to the list
                for (let i = 0; i < servers.length; i++) {
                    let serverConnections = servers[i].connections;

                    // Filter servers based off the local address checkbox
                    if (localStorage.useLocalAddress) {
                        serverConnections = serverConnections.filter(conn => conn.local == true);
                    } else {
                        serverConnections = serverConnections.filter(conn => conn.local == false);
                    }

                    // Filter servers based on http / https site loaded
                    if (location.protocol == 'http:') {
                        serverConnections = serverConnections.filter(conn => conn.protocol == "http");
                    } else {
                        serverConnections = serverConnections.filter(conn => conn.protocol == "https");
                    }

                    serverList.push({
                        name: servers[i].name,
                        accessToken: servers[i].accessToken,
                        connections: serverConnections,
                    });
                }
                // Populate the servers in the list of servers
                displayServers(servers);
            } else {
                console.log("ERROR L301: There are no results in the list of servers!");
            }
        },
        "error": (data) => {
            console.log("ERROR L224");
            console.log(data);
            if (data.status == 401) {
                console.log("Unauthorized");
                $("#pinAuthWarning").html(`<div class="alert alert-warning alert-dismissible fade show mt-3" role="alert">
                        <strong>Warning:</strong> Unauthorized (401) - It looks like the old PIN code is no longer valid. Please choose the "Click here to logout" above to authorise again.
                        <button type="button" class="close" data-dismiss="alert" aria-label="Close">
                            <span aria-hidden="true">&times;</span>
                        </button>
                    </div>`);
            }
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
                        <td>${servers[i].name}</td>
                    </tr>`;
        $("#serverTable tbody").append(rowHTML);
    }
}

async function chooseServer(number, row) {
    $("#userTable tbody").empty();
    $("#libraryTable tbody").empty();
    $("#tvShowsTable tbody").empty();
    $("#seasonsTable tbody").empty();
    $("#episodesTable tbody").empty();
    $("#audioTable tbody").empty();
    $("#subtitleTable tbody").empty();
    $('#alphabetGroup').children().removeClass("btn-dark").addClass("btn-outline-dark").prop("disabled", true);

    $(row).siblings().removeClass("table-active");
    $(row).addClass("table-active");

    plexToken = serverList[number].accessToken;
    plexAdminToken = plexToken;
    let connections = serverList[number].connections;

    // Loop through the connections to see if we can find one that works
    for (let i = 0; i < connections.length; i++) {
        try {
            let testResult = await $.ajax({
                "url": `${connections[i].uri}/identity`,
                "method": "GET",
                "headers": {
                    "X-Plex-Client-Identifier": clientIdentifier,
                    "X-Plex-Token": plexAdminToken,
                    "Accept": "application/json"
                }
            });

            // Check if it is a valid server
            if (testResult.MediaContainer.machineIdentifier != undefined) {
                console.log(testResult); //"0dc6987b21c52f78a156bd583aa5a82f6ff825e8"
                machineIdentifier = testResult.MediaContainer.machineIdentifier;

                let testResult2 = await $.ajax({ // TODO
                    "url": `https://plex.tv/api/v2/home/users`,
                    "method": "GET",
                    "headers": {
                        "X-Plex-Client-Identifier": clientIdentifier,
                        "X-Plex-Token": plexAdminToken,
                        "Accept": "application/json"
                    }
                });
                console.log(testResult2);

                plexUrl = connections[i].uri;
                getUserAccounts();
                break;
            }
        } catch (e) {}
    }
}

function getUserAccounts() {
    // Get managed accounts
    $.ajax({
        "url": `https://plex.tv/api/v2/home/users`,
        "method": "GET",
        "headers": {
            "X-Plex-Client-Identifier": clientIdentifier,
            "X-Plex-Token": plexAdminToken,
            "accept": "application/json"
        },
        "success": (data) => {
            if (data.users.length == 0) {
                connectToPlex();
            } else {
                let userAccounts = [];
                for (let i = 0; i < data.users.length; i++) {
                    userAccounts.push(data.users[i]);
                }
                console.log(userAccounts);
                // Populate and show the users table
                displayUserAccounts(userAccounts);
            }
        },
        "error": (error) => {
            console.log(error);
        }
    });
}

function displayUserAccounts(users) {
    $("#userTable tbody").empty();
    $("#libraryTable tbody").empty();
    $("#tvShowsTable tbody").empty();
    $("#seasonsTable tbody").empty();
    $("#episodesTable tbody").empty();
    $("#audioTable tbody").empty();
    $("#subtitleTable tbody").empty();

    for (let i = 0; i < users.length; i++) {
        let rowHTML = `<tr onclick="switchUser('${users[i].id}', '${users[i].username != null ? "false" : "true"}',  this)">
                        <td>${users[i].title}</td>
                    </tr>`;
        $("#userTable tbody").append(rowHTML);
    }

    $('#userTableContainer').show();
}

function switchUser(userId, isManaged, row) {
    $("#libraryTable tbody").empty();
    $("#tvShowsTable tbody").empty();
    $("#seasonsTable tbody").empty();
    $("#episodesTable tbody").empty();
    $("#audioTable tbody").empty();
    $("#subtitleTable tbody").empty();

    $(row).siblings().removeClass("table-active");
    $(row).addClass("table-active");

    if (isManaged == "false") {
        plexToken = plexAdminToken;
        connectToPlex();
    }
    else {
        $.ajax({
            "url": `https://plex.tv/api/servers/${machineIdentifier}/shared_servers`,
            "method": "GET",
            "headers": {
                "X-Plex-Token": plexAdminToken,
                "accept": "application/json;odata=nometadata"
            },
            "success": (data) => {
                console.log(data);
                $(data).find('SharedServer').each(function() {
                    if ($(this).attr('userID') == userId) {
                        var authToken = $(this).attr('accessToken');
                        console.log(authToken);
                        plexToken = authToken;
                        connectToPlex();
                    }
                })
            },
            "error": (error) => {
                console.log(error);
            }
        })
    }
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
                $('#btnConnectToPlex').hide();
                $('#rememberDetails, #plexUrl, #plexToken').prop('disabled', true);
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
            else if ((location.protocol == 'https:') && (localStorage.isPinAuth) && (plexUrl.indexOf('http:') > -1)) {
                console.log("Trying to use http over a https site with PIN authentication");
                $("#pinAuthWarning").html(`<div class="alert alert-warning alert-dismissible fade show mt-3" role="alert">
                        <strong>Warning:</strong> Error - You are trying to access a http server via the site in https. If you cannot see your libraries below, please load this site \
                        over http by <a href="http://www.pastatool.com">clicking here</a>.
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
         let rowHTML = `<tr onclick="getAlphabet(${libraries[i].key}, '${libraries[i].type}', this); setupShowSearch(${libraries[i].key}, '${libraries[i].type}')">
                        <td>${libraries[i].title}</td>
                    </tr>`;
        $("#libraryTable tbody").append(rowHTML);
    }
    // Scroll to the table
    document.querySelector('#libraryTable').scrollIntoView({
        behavior: 'smooth' 
    });
}

function setupShowSearch(libraryKey, libType) {
    $(document).off('input', '#showSearchInput');
    $(document).off('click', '#clearShowSearch');
    window.showSearchSetup = true;
    let allShowsCache = null;
    async function fetchAllShows() {
        if (allShowsCache) return allShowsCache;
        try {
            const result = await $.ajax({
                "url": `${plexUrl}/library/sections/${libraryKey}/all`,
                "method": "GET",
                "headers": {
                    "X-Plex-Token": plexToken,
                    "Accept": "application/json"
                }
            });
            allShowsCache = result.MediaContainer.Metadata || [];
            return allShowsCache;
        } catch (e) {
            return [];
        }
    }
    $(document).on('input', '#showSearchInput', async function() {
        $('#alphabetGroup .btn').removeClass('btn-dark').addClass('btn-outline-dark');
        const search = $(this).val().toLowerCase();
        if (search.length === 0) {
            $("#tvShowsTable tbody").empty();
            return;
        }
        const allShows = await fetchAllShows();
        const filtered = allShows.filter(show => show.title && show.title.toLowerCase().includes(search));
        $("#tvShowsTable tbody").empty();
        for (let i = 0; i < filtered.length; i++) {
            let rowHTML = `<tr onclick=\"getTitleInfo(${filtered[i].ratingKey}, this)\">\n<td>${filtered[i].title}</td>\n<td>${filtered[i].year}</td>\n</tr>`;
            $("#tvShowsTable tbody").append(rowHTML);
        }
    });
    $(document).on('click', '#clearShowSearch', function() {
        $('#showSearchInput').val('');
        $('#alphabetGroup .btn').removeClass('btn-dark').addClass('btn-outline-dark');
        $("#tvShowsTable tbody").empty();
    });
}

function getAlphabet(uid, libType, row) {
    $.ajax({
        "url": `${plexUrl}/library/sections/${uid}/firstCharacter`,
        "method": "GET",
        "headers": {
            "X-Plex-Token": plexToken,
            "Accept": "application/json"
        },
        "success": (data) => {
            libraryNumber = uid;
            displayAlphabet(data, libType, row);
            $('#series-tab').tab('show');
        },
        "error": (data) => {
            console.log("ERROR L428");
            console.log(data);
        }
    });
}

function displayAlphabet(data, libType, row) {
    const availableAlphabet = data.MediaContainer.Directory;

    if ( libType == 'show') { libraryType = "shows"; }
    else { libraryType = "movie"; }

    if (data.MediaContainer.thumb.indexOf('video') > -1) {
        // Update the tab names to "Videos" and "Tracks"
        $('#series-tab').html("Videos");
        $('#episodes-tab').html("Tracks");
        $('#libraryTypeTitle').html("Other Videos");
    } else if (libraryType == "shows") {
        // Update the tab names to "Series" and "Episodes"
        $('#series-tab').html("Series");
        $('#episodes-tab').html("Episodes");
        $('#libraryTypeTitle').html("TV Series");
    } else {
        // Update the tab names to "Movies" and "Tracks"
        $('#series-tab').html("Movies");
        $('#episodes-tab').html("Tracks");
        $('#libraryTypeTitle').html("Movies");
    }

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

    // Get the non-English characters
    const nonEngChars = availableAlphabet.filter(entry => !entry.title.match(/[a-z#]/i));

    // Remove all custom buttons after the Z
    $('#btnZ').nextAll().remove();

    if (nonEngChars.length > 0) {
        // Add buttons for the non English characters
        for (let j = 0; j < nonEngChars.length; j++) {
            $('#alphabetGroup').append(`<button id="btn${nonEngChars[j].title}" type="button" class="btn btn-outline-dark"
            onclick="getLibraryByLetter(this)">${nonEngChars[j].title}</button>`);
        }
    }
}

function getLibraryByLetter(element) {
    let letter = $(element).text();
    if (letter == "#") letter = "%23";

    $('#showSearchInput').val('');

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
            console.log("ERROR L473");
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

    // Store the last loaded shows for search filtering
    window.lastLoadedShows = tvShows || [];

    function renderShowsTable(shows) {
        $("#tvShowsTable tbody").empty();
        for (let i = 0; i < shows.length; i++) {
            let rowHTML = `<tr onclick=\"getTitleInfo(${shows[i].ratingKey}, this)\">
                            <td>${shows[i].title}</td>
                            <td>${shows[i].year}</td>
                        </tr>`;
            $("#tvShowsTable tbody").append(rowHTML);
        }
    }

    renderShowsTable(tvShows);

    if (!window.showSearchSetup) {
        window.showSearchSetup = true;
        let allShowsCache = null;
        async function fetchAllShows() {
            if (allShowsCache) return allShowsCache;
            // Fetch all shows in the current library
            try {
                const result = await $.ajax({
                    "url": `${plexUrl}/library/sections/${libraryNumber}/all`,
                    "method": "GET",
                    "headers": {
                        "X-Plex-Token": plexToken,
                        "Accept": "application/json"
                    }
                });
                allShowsCache = result.MediaContainer.Metadata || [];
                return allShowsCache;
            } catch (e) {
                return [];
            }
        }

        $(document).on('input', '#showSearchInput', async function() {
            const search = $(this).val().toLowerCase();
            if (search.length === 0) {
                renderShowsTable(window.lastLoadedShows || []);
                return;
            }
            const allShows = await fetchAllShows();
            const filtered = allShows.filter(show => show.title && show.title.toLowerCase().includes(search));
            renderShowsTable(filtered);
        });
        $(document).on('click', '#clearShowSearch', function() {
            $('#showSearchInput').val('');
            renderShowsTable(window.lastLoadedShows || []);
        });
    }

    // Scroll to the table
    document.querySelector('#tvShowsTable').scrollIntoView({
        behavior: 'smooth' 
    });
}

function getTitleInfo(uid, row) {
    showId = uid;
    if (libraryType == "movie") {
        getEpisodeInfo(uid, row);
        // Hide TV shows tables and switches
        $('#seasonsTableContainer').hide();
        $('#episodesTableContainer').hide();
        $('#switchToggleContainer').hide();
        // Update the name of the Movie in the placeholder
        $('#movieNamePlaceholder').show();
        $('#movieNamePlaceholder h2').html(`${$(row).children().first().html()} (${$(row).children().last().html()})`);
        // Swap to the tab
        $('#episodes-tab').tab('show');
    } else {
        $('#seasonsTableContainer').show();
        $('#episodesTableContainer').show();
        $('#switchToggleContainer').show();
        $('#movieNamePlaceholder').hide();
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
                console.log("ERROR L510");
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
            console.log("ERROR L561");
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
                        <td>S${episodes[i].parentIndex}E${episodes[i].index} - ${episodes[i].title}</td>
                    </tr>`;
        $("#episodesTable tbody").append(rowHTML);
    }
    // Scroll to the table
    document.querySelector('#episodesTable').scrollIntoView({
        behavior: 'smooth' 
    });
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
            console.log("ERROR L596");
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

    // Scroll to the table
    document.querySelector('#audioTable').scrollIntoView({
        behavior: 'smooth' 
    });
}

async function setAudioStream(partsId, streamId, row) {
    let singleEpisode = $("#singleEpisode").prop("checked");
    let singleSeason = $("#singleSeason").prop("checked");
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
                // Show the toast
                let audioTrackName = $(row).find('td.name')[0].innerText;
                $('#successToast .toast-body').html( `Audio track successfully updated to <strong>${audioTrackName}</strong>`);
                $('#successToast').toast('show');
            },
            "error": (data) => {
                console.log("ERROR L670");
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
        if (singleSeason) {
            // If the "Single Season" button is selected, we only want to change the current season's episodes
            let seasonEpisodes = await $.ajax({
                "url": `${plexUrl}/library/metadata/${seasonId}/children`,
                "method": "GET",
                "headers": {
                    "X-Plex-Token": plexToken,
                    "Accept": "application/json"
                }
            });
            for (let k = 0; k < seasonEpisodes.MediaContainer.Metadata.length; k++) {
                episodeList.push(seasonEpisodes.MediaContainer.Metadata[k].ratingKey);
            }
        } else {
            // Else we want to get all the episodes from every season
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
        }

        // Set the progress bar to have a certain length
        maxProgress = episodeList.length;
        $('#progressBar').attr('aria-valuemax', maxProgress);
        // We have the episodes in episodeList, now we need to go through each one and see what streams are available
        for (let i = 0; i < episodeList.length; i++) {
            // Update the progressbar
            currentProgress++;
            const calculatedWidth = (currentProgress / maxProgress) * 100;
            $('#progressBar').width(`${calculatedWidth}%`);
            $('#progressBar').attr('aria-valuenow', currentProgress);

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

        // Reset the progress bar and modal text
        $("#modalBodyText #modalTitleText").text("Updating matches... Please do not close this tab or refresh until the process is complete.");
        maxProgress = promiseConstructors.length;
        $('#progressBar').attr('aria-valuemax', maxProgress);
        $('#progressBar').attr('aria-valuenow', 0);

        function futurePromise(data) {
            return axios({
                "url": data.url,
                "method": "POST",
                "headers": {
                    "X-Plex-Token": plexToken,
                    "Accept": "application/json"
                }
            }).then((_result) => {
                handleProgress();
                return data;
            });
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
                matchPromises.forEach(async (matchPromise) => {
                    await matchPromise.then((data) => {
                        $('#progressModal #modalBodyText').append(data.messageAppend);
                        $(row).siblings().removeClass("table-active");
                        $(row).addClass("table-active");
                    }).catch((e) => console.log(e));
                })
            })
            .then(() => {
                $('#modalBodyText .alert').removeClass("alert-warning").addClass("alert-success");
                $("#modalBodyText #modalTitleText").text("Processing Complete! You can now close this popup.");
                $('#modalBodyText #progressBarContainer').hide();
            });
        }
        catch (e) {
            console.log("ERROR L936");
            console.log(e);
        }
    }
}

async function setSubtitleStream(partsId, streamId, row) {
    let singleEpisode = $("#singleEpisode").prop("checked");
    let singleSeason = $("#singleSeason").prop("checked");
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
                // Show the toast
                let subtitleTrackName = $(row).find('td.name')[0].innerText;
                $('#successToast .toast-body').html( `Subtitle track successfully updated to <strong>${subtitleTrackName}</strong>`);
                $('#successToast').toast('show');
            },
            "error": (data) => {
                console.log("ERROR L965");
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
                    <span id="modalTitleText">Processing Episodes... Please do not close this tab or refresh until the process is complete.</span>
            </div>
            <div class="progress mt-2" id="progressBarContainer">
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
        if (singleSeason) {
            // If the "Single Season" button is selected, we only want to change the current season's episodes
            let seasonEpisodes = await $.ajax({
                "url": `${plexUrl}/library/metadata/${seasonId}/children`,
                "method": "GET",
                "headers": {
                    "X-Plex-Token": plexToken,
                    "Accept": "application/json"
                }
            });
            for (let k = 0; k < seasonEpisodes.MediaContainer.Metadata.length; k++) {
                episodeList.push(seasonEpisodes.MediaContainer.Metadata[k].ratingKey);
            }
        } else {
            // Else we want to get all the episodes from every season
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
        }

        // Set the progress bar to have a certain length
        maxProgress = episodeList.length;
        $('#progressBar').attr('aria-valuemax', maxProgress);
        // We have the episodes in episodeList, now we need to go through each one and see what streams are available
        for (let i = 0; i < episodeList.length; i++) {
            // Update the progressbar
            currentProgress++;
            const calculatedWidth = (currentProgress / maxProgress) * 100;
            $('#progressBar').width(`${calculatedWidth}%`);
            $('#progressBar').attr('aria-valuenow', currentProgress);

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
                // Get the subtitle keyword from the UI
                let subtitleKeyword = $('#subtitleKeywordInput').val().trim().toLowerCase();

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
                        // If a keyword is set, skip this subtitle if it doesn't match
                        if (subtitleKeyword &&
                            !(String(episodeStreams[j].title || '').toLowerCase().includes(subtitleKeyword) ||
                              String(episodeStreams[j].displayTitle || '').toLowerCase().includes(subtitleKeyword))) {
                            continue;
                        }
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

        // Reset the progress bar and modal text
        $("#modalBodyText #modalTitleText").text("Updating matches... Please do not close this tab or refresh until the process is complete.");
        maxProgress = promiseConstructors.length;
        $('#progressBar').attr('aria-valuemax', maxProgress);
        $('#progressBar').attr('aria-valuenow', 0);

        function futurePromise(data) {
            return axios({
                "url": data.url,
                "method": "POST",
                "headers": {
                    "X-Plex-Token": plexToken,
                    "Accept": "application/json"
                }
            }).then((_result) => {
                handleProgress();
                return data;
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
                matchPromises.forEach(async (matchPromise) => {
                    await matchPromise.then((data) => {
                        $('#progressModal #modalBodyText').append(data.messageAppend);
                        $(row).siblings().removeClass("table-active");
                        $(row).addClass("table-active");
                    }).catch((e) => console.log(e));
                })
            })
            .then(() => {
                $('#modalBodyText .alert').removeClass("alert-warning").addClass("alert-success");
                $("#modalBodyText #modalTitleText").text("Processing Complete! You can now close this popup.");
                $('#modalBodyText #progressBarContainer').hide();
            });
        }
        catch (e) {
                console.log("ERROR L1241");
                console.log(e);
        }
    }
}
