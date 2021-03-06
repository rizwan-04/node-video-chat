import React from 'react';
import PropTypes from 'prop-types';
import { renderRoutes } from 'react-router-config';
import { graphql } from 'react-apollo';
import { connect } from 'react-redux';
import { compose } from 'redux';
import { withRouter } from 'react-router-dom';
import cloneDeep from 'lodash.clonedeep';

import QUERY_USER_ID from '../graphql/queries/user/id.graphql';
import QUERY_PENDING_CONTACT_REQUESTS from '../graphql/queries/contact-requests/pending-requests.graphql';
import QUERY_CONTACTS from '../graphql/queries/contacts/contacts.graphql';
import QUERY_MESSAGE_THREADS from '../graphql/queries/message-threads/message-threads.graphql';
import SUBSCRIBE_TO_CONTACT_REQUEST_RECEIVED from '../graphql/subscriptions/contact-requests/contact-request-received.graphql';
import SUBSCRIBE_TO_CONTACT_REQUEST_ACCEPTED from '../graphql/subscriptions/contact-requests/contact-request-accepted.graphql';
import SUBSCRIBE_TO_USER_STATUS_CHANGE from '../graphql/subscriptions/users/status-change.graphql';
import SUBSCRIBE_TO_USER_UPDATES from '../graphql/subscriptions/users/update.graphql';
import SUBSCRIBE_TO_MESSAGES_CREATED from '../graphql/subscriptions/messages/message-created.graphql';
import { LOGIN_ROUTE, SIGNUP_ROUTE } from '../constants';

import isLoggedIn from '../helpers/is-logged-in';
import { addNotice } from '../actions/notice';
import { handleHangUp } from '../actions/call';
import Topbar from '../components/Layout/Topbar';
import VideoChat from './VideoChat';
import BannerContainer from '../components/Layout/BannerContainer';

import '../styles/layout.scss';

/**
 * @class PageLayout
 * @extends {React.PureComponent}
 */
class PageLayout extends React.PureComponent {
  /**
   * @constructor
   * @constructs PageLayout
   * @param {Object} props for component
   */
  constructor(props) {
    super(props);
    this.state = { isMobileDevice: false };
    this.isAuthRoute = this.isAuthRoute.bind(this);
    this.isMobileDevice = this.isMobileDevice.bind(this);
    try {
      this.messageSound = document.getElementById('message-sound');
      this.contactSound = document.getElementById('contact-sound');
    } catch (err) {
      this.messageSound = null;
      this.contactSound = null;
    }
  }
  /**
   * @returns {undefined}
   */
  componentDidMount() {
    if (!isLoggedIn(this.props.currentSession.user) && !this.isAuthRoute()) {
      this.context.router.history.replace(LOGIN_ROUTE);
    }
    this.subscribeToNewContactRequests();
    this.subscribeToAcceptedContactRequests();
    this.subscribeToStatusChanges();
    this.subscribeToNewMessages();
    this.subscribeToUserUpdates();
  }
  /**
   * @param {Object} props before update
   * @returns {undefined}
   */
  componentDidUpdate(props) {
    if (isLoggedIn(props.currentSession.user) && !isLoggedIn(this.props.currentSession.user)) {
      this.context.router.history.replace(LOGIN_ROUTE);
    }
    this.subscribeToNewContactRequests();
    this.subscribeToAcceptedContactRequests();
    this.subscribeToStatusChanges();
    this.subscribeToNewMessages();
    this.subscribeToUserUpdates();
  }
  /**
   * @returns {boolean} true if on the login/signup page
   */
  isAuthRoute() {
    return (
      this.props.location.pathname === SIGNUP_ROUTE
      || this.props.location.pathname === LOGIN_ROUTE
    );
  }
  /**
   * @returns {boolean} true if user is on mobile device
   */
  isMobileDevice() {
    const mobileDeviceRegex = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;
    return mobileDeviceRegex.test(this.props.userAgent);
  }
  /**
   * @returns {undefined}
   */
  subscribeToNewContactRequests() {
    if (this.newContacts) this.newContacts();
    this.newContacts = this.props.pendingRequests.subscribeToMore({
      document: SUBSCRIBE_TO_CONTACT_REQUEST_RECEIVED,
      variables: {
        userId: this.props.currentSession.user && this.props.currentSession.user.id,
      },
      updateQuery: (prev, { subscriptionData: { data } }) => {
        if (!data || !data.requestReceived) return prev;
        if (this.contactSound) {
          this.contactSound.play();
        }
        this.props.addNotice(`${data.requestReceived.sender.username} sent you a contact request!`);
        return {
          ...prev,
          data: [
            data.requestReceived,
            ...prev.data,
          ],
        };
      },
    });
  }
  /**
   * @returns {undefined}
   */
  subscribeToAcceptedContactRequests() {
    if (this.newContactRequests) this.newContactRequests();
    this.newContactRequests = this.props.contacts.subscribeToMore({
      document: SUBSCRIBE_TO_CONTACT_REQUEST_ACCEPTED,
      variables: {
        userId: this.props.currentSession.user && this.props.currentSession.user.id,
      },
      updateQuery: (prev, { subscriptionData: { data } }) => {
        if (!data || !data.newContact) return prev;
        if (this.contactSound) {
          this.contactSound.play();
        }
        this.props.addNotice(`${data.newContact.user.username} accepted your contact request!`);
        return {
          ...prev,
          data: [
            data.newContact,
            ...prev.data,
          ],
        };
      },
    });
  }
  /**
   * @returns {undefined}
   */
  subscribeToStatusChanges() {
    if (this.statusChanges) this.statusChanges();
    this.statusChanges = this.props.contacts.subscribeToMore({
      document: SUBSCRIBE_TO_USER_STATUS_CHANGE,
      variables: {
        userIds: this.props.contacts.data ? this.props.contacts.data.map(contact => contact.user.id) : [],
      },
      updateQuery: (prev, { subscriptionData: { data } }) => {
        if (!data || !data.user) return prev;
        const newData = cloneDeep(prev.data).map((contact) => {
          if (data.user.id === contact.user.id) {
            if (
              contact.id === this.props.callingContactId
              && data.user.status === 'offline'
            ) this.props.handleHangUp();
            return { ...contact, user: data.user };
          }
          return contact;
        });
        return {
          ...prev,
          data: newData,
        };
      },
    });
  }
  /**
   * @returns {undefined}
   */
  subscribeToUserUpdates() {
    if (this.userUpdates) this.userUpdates();
    this.userUpdates = this.props.contacts.subscribeToMore({
      document: SUBSCRIBE_TO_USER_UPDATES,
      variables: {
        userIds: this.props.contacts.data ? this.props.contacts.data.map(contact => contact.user.id) : [],
      },
      updateQuery: (prev, { subscriptionData: { data } }) => {
        if (!data || !data.user) return prev;
        const newData = cloneDeep(prev.data).map((contact) => {
          if (data.user.id === contact.user.id) {
            if (
              contact.id === this.props.callingContactId
              && data.user.status === 'offline'
            ) this.props.handleHangUp();
            return { ...contact, user: { ...contact.user, ...data.user } };
          }
          return contact;
        });
        return {
          ...prev,
          data: newData,
        };
      },
    });
  }
  /**
   * @returns {undefined}
   */
  subscribeToNewMessages() {
    if (this.newMessages) this.newMessages();
    this.newMessages = this.props.messageThreads.subscribeToMore({
      document: SUBSCRIBE_TO_MESSAGES_CREATED,
      variables: {
        forUserId: Number(this.props.currentSession.user.id),
      },
      updateQuery: (prev, { subscriptionData: { data } }) => {
        if (!data || !data.messageCreated) return prev;
        if (!prev.data.find(thread => thread.id === data.messageCreated.threadId)) {
          this.props.messageThreads.refetch();
          return prev;
        }
        if (data.messageCreated.senderId !== Number(this.props.currentSession.user.id)) {
          this.messageSound.play();
        }
        return {
          ...prev,
          data: prev.data.map((thread) => {
            if (data.messageCreated.threadId !== thread.id) return thread;
            return {
              ...thread,
              latestMessage: data.messageCreated,
            };
          }),
        };
      },
    });
  }
  /**
   * render
   * @returns {JSX.Element} HTML
   */
  render() {
    if (this.isMobileDevice()) {
      return (
        <div className="app-container flex-column">
          <Topbar />
          <div className="flex-center">
            <span className="text-center mobile-text">
              Sorry, WebChat uses WebRTC for communications,
              which is not supported by most mobile browsers yet.
            </span>
          </div>
        </div>
      );
    }
    return (
      <div className="app-container">
        <Topbar />
        {!isLoggedIn(this.props.currentSession.user) &&
          <BannerContainer />}
        <div className="app-content display-flex">
          {isLoggedIn(this.props.currentSession.user) &&
            <VideoChat />}
          {renderRoutes(this.props.route.routes)}
        </div>
      </div>
    );
  }
}

PageLayout.contextTypes = {
  router: PropTypes.shape(),
};

PageLayout.propTypes = {
  userAgent: PropTypes.string,
  location: PropTypes.shape(),
  route: PropTypes.shape(),
  currentSession: PropTypes.shape({
    user: PropTypes.shape(),
    refetch: PropTypes.func,
  }),
  pendingRequests: PropTypes.shape({
    data: PropTypes.arrayOf(PropTypes.shape()),
    subscribeToMore: PropTypes.func,
  }),
  contacts: PropTypes.shape({
    data: PropTypes.arrayOf(PropTypes.shape()),
    subscribeToMore: PropTypes.func,
  }),
  messageThreads: PropTypes.shape({
    data: PropTypes.arrayOf(PropTypes.shape()),
    subscribeToMore: PropTypes.func,
    refetch: PropTypes.func,
  }),
  addNotice: PropTypes.func,
  callingContactId: PropTypes.number,
  handleHangUp: PropTypes.func,
};

export default compose(
  withRouter,
  connect(
    state => ({ callingContactId: state.call.callingContactId }),
    { addNotice, handleHangUp },
  ),
  graphql(
    QUERY_USER_ID,
    { name: 'currentSession' },
  ),
  graphql(
    QUERY_PENDING_CONTACT_REQUESTS,
    { name: 'pendingRequests' },
  ),
  graphql(
    QUERY_CONTACTS,
    { name: 'contacts' },
  ),
  graphql(
    QUERY_MESSAGE_THREADS,
    { name: 'messageThreads' },
  ),
)(PageLayout);
