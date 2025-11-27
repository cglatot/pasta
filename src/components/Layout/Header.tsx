import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useHomeUsers } from '../../hooks/usePlexQueries';
import { useIsMobile } from '../../hooks/useIsMobile';
import { SettingsModal } from './SettingsModal';

interface Props {
    onSwitchUser?: () => void;
}

export const Header: React.FC<Props> = ({ onSwitchUser }) => {
    const { user, logout, clearServer, isAuthenticated, clientIdentifier, accessToken, adminToken, isSharedServer } = useAuth();
    const [showHelpModal, setShowHelpModal] = useState(false);
    const [showSettingsModal, setShowSettingsModal] = useState(false);
    const [showDropdown, setShowDropdown] = useState(false);
    const [hasManagedUsers, setHasManagedUsers] = useState(false);
    const isMobile = useIsMobile();

    const { data: homeUsers } = useHomeUsers(clientIdentifier, adminToken || accessToken);

    useEffect(() => {
        if (homeUsers) {
            setHasManagedUsers(homeUsers.length > 1);
        }
    }, [homeUsers]);

    return (
        <>
            <nav className="navbar navbar-expand-lg navbar-dark static-top" style={{ backgroundColor: '#0d0d0d' }}>
                <div className={`container-fluid ${isMobile ? 'flex-column' : 'd-flex justify-content-between'} px-5`}>
                    <div className={isMobile ? 'w-100 text-center mb-2' : ''}>
                        <a className="navbar-brand" href="/" style={isMobile ? { marginRight: 0 } : undefined}>
                            <img src="/images/Logo_Title_Large.png" alt="PASTA" height="50" />
                        </a>
                    </div>

                    <div className={`d-flex align-items-center ${isMobile ? 'w-100 justify-content-center' : ''}`}>
                        {isAuthenticated && user && (
                            <div className="dropdown me-3">
                                <button
                                    className="btn btn-link text-light text-decoration-none d-flex align-items-center p-0"
                                    onClick={() => setShowDropdown(!showDropdown)}
                                    onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
                                >
                                    <img
                                        src={user.thumb}
                                        alt={user.username}
                                        className="rounded-circle me-2"
                                        style={{ width: 32, height: 32 }}
                                    />
                                    <span>{user.username || user.title}</span>
                                    <i className={`fas fa-chevron-${showDropdown ? 'up' : 'down'} ms-2 small`}></i>
                                </button>
                                {showDropdown && (
                                    <ul className="dropdown-menu dropdown-menu-end show" style={{ position: 'absolute', right: 0 }}>
                                        <li>
                                            <button className="dropdown-item" onClick={() => { clearServer(); setShowDropdown(false); }}>
                                                <i className="fas fa-server me-2"></i>
                                                Change Server
                                            </button>
                                        </li>
                                        {hasManagedUsers && onSwitchUser && !isSharedServer && (
                                            <li>
                                                <button className="dropdown-item" onClick={() => { onSwitchUser(); setShowDropdown(false); }}>
                                                    <i className="fas fa-user-friends me-2"></i>
                                                    Switch User
                                                </button>
                                            </li>
                                        )}
                                        <li><hr className="dropdown-divider" /></li>
                                        <li>
                                            <button className="dropdown-item text-danger" onClick={() => { logout(); setShowDropdown(false); }}>
                                                <i className="fas fa-sign-out-alt me-2"></i>
                                                Logout
                                            </button>
                                        </li>
                                    </ul>
                                )}
                            </div>
                        )}

                        <button
                            onClick={() => setShowSettingsModal(true)}
                            className="btn btn-link text-warning ms-3 p-0"
                            style={{ border: 'none', background: 'none' }}
                            title="Settings"
                        >
                            <i className="fas fa-cog fa-lg"></i>
                        </button>

                        <a href="https://ko-fi.com/cglatot" target="_blank" rel="noreferrer" className="text-warning ms-3">
                            <i className="fas fa-mug-hot fa-lg"></i>
                        </a>
                        <a href="https://hub.docker.com/r/cglatot/pasta" target="_blank" rel="noreferrer" className="text-warning ms-3">
                            <i className="fab fa-docker fa-lg"></i>
                        </a>
                        <a href="https://github.com/cglatot/pasta" target="_blank" rel="noreferrer" className="text-warning ms-3">
                            <i className="fab fa-github fa-lg"></i>
                        </a>
                        <button
                            onClick={() => setShowHelpModal(true)}
                            className="btn btn-link text-warning ms-3 p-0"
                            style={{ border: 'none', background: 'none' }}
                        >
                            <i className="far fa-circle-question fa-lg"></i>
                        </button>
                    </div>
                </div>
            </nav>

            <SettingsModal show={showSettingsModal} onClose={() => setShowSettingsModal(false)} />

            {showHelpModal && (
                <div className="modal show d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
                    <div className="modal-dialog modal-xl modal-dialog-centered">
                        <div className="modal-content">
                            <div className="modal-header">
                                <h5 className="modal-title">Help & About</h5>
                                <button type="button" className="btn-close" onClick={() => setShowHelpModal(false)}></button>
                            </div>
                            <div className="modal-body">
                                <p>Encountered a bug, or have a feature request? Log it here:
                                    <a href="https://github.com/cglatot/pasta/issues" target="_blank" rel="noreferrer"> https://github.com/cglatot/pasta/issues</a>
                                </p>
                                <h3>What is PASTA?</h3>
                                <p>Do you watch TV Shows with multiple languages and subtitles and wish you could change them for the
                                    entire show, rather than needing to do it for <em>every. single. episode</em>?
                                    Or maybe you aren't sure what the difference is between those 2 <strong>English (SRT)</strong> and
                                    <strong> English (SRT)</strong> subtitle files. Then PASTA is for you!
                                    <br />PASTA allows you to connect to your Plex server and view more details about the audio tracks and
                                    subtitles, as well as set the tracks and subtitles for entire shows, or single episodes very quickly.
                                </p>
                                <h3>How do I use PASTA?</h3>
                                <p>I built PASTA to be as step-by-step as possible and to take you through it, so you should be able to
                                    just close this pop-up and follow along.
                                    <br />There are some things I would like to point out, however:
                                </p>
                                <ul>
                                    <li>This works <strong>MUCH</strong> faster if you are on the same network as the Plex Server.</li>
                                    <li>If you use Unraid, this is now available in the Community Applications.</li>
                                    <li>You can also run this locally yourself. Just download the source code from github (see link above).</li>
                                </ul>
                                <h3>About PASTA</h3>
                                <p>When I first began developing this for myself, I was calling it <em>Audio Track Automation for Plex</em>,
                                    so adding "subtitles" to it, and rearranging the letters gave birth to PASTA.
                                </p>
                                <p>PASTA was born out of a desire, one that I had seen others have as well, but that I had only
                                    seen one other solution for. However, it was in command line and I wanted something a bit more appealing to look at, and something I could
                                    use from anywhere.
                                    Initially I was only building this for myself but I thought that others might find use for
                                    it as well, so here we are!
                                </p>
                                <p>PASTA runs entirely client-side. This means that you are not passing anything to someones
                                    server to do this (other than the Plex Server), and it also means I don't
                                    have to worry about standing up a server to do that side of things either :). PASTA runs off
                                    of Github Pages, and I've got a link to my
                                    repository below. Feel free to have a look, download it yourself and use it locally, or make
                                    suggestions. I'm by no means finished with
                                    PASTA - I still have plenty of ideas for how I can add more to it, as well as fix any bugs
                                    that crop up.
                                </p>
                                <h3>Cookie Policy</h3>
                                <p>The site uses some minor technical cookies to help improve your experience (for example, remembering your details if you choose that option).
                                    Third-party cookies are not used on this site. By continuing to use this site, you agree to the use of these functional cookies.
                                </p>
                                <div className="text-center my-3">
                                    <a href="https://ko-fi.com/cglatot" target="_blank" rel="noreferrer" className="btn btn-warning btn-lg text-dark fw-bold">
                                        <i className="fas fa-mug-hot me-2"></i>
                                        Buy me a coffee on Ko-fi
                                    </a>
                                </div>
                                <p>Enjoying the tool? Consider adding to my coffee funds :)</p>
                            </div>
                            <div className="modal-footer">
                                <button type="button" className="btn btn-secondary" onClick={() => setShowHelpModal(false)}>Close</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};
