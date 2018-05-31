import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import classNames from 'classnames';

import { preferOpus } from '../helpers/sdp-helpers';
import {
  CallStatuses,
  acceptCall,
  ignoreCall,
  handleIceCandidate,
  sendSessionDescription,
  setCallStatusToInCall,
  setCallStatusToAvailable,
  emitHangup,
} from '../actions/call';
import { addError } from '../actions/error';
import Available from '../components/VideoChat/Available';
import Calling from '../components/VideoChat/Calling';
import ReceivingCall from '../components/VideoChat/ReceivingCall';
import Controller from '../components/VideoChat/Controller';
import CallOverlay from '../components/VideoChat/CallOverlay';
import '../styles/video-chat-container.scss';

const SDP_CONSTRAINTS = {
  mandatory: {
    OfferToReceiveAudio: true,
    OfferToReceiveVideo: true,
  },
};

/**
 * @class VideoChat
 * @extends {React.PureComponent}
 */
class VideoChat extends React.PureComponent {
  /**
   * @static
   * @param {Object} stream to stop
   * @returns {undefined}
   */
  static stopStream(stream) {
    return stream.getTracks().forEach(track => track.stop());
  }
  /**
   * @constructor
   * @constructs VideoChat
   * @param {Object} props for component
   */
  constructor(props) {
    super(props);
    this.state = { isInitiator: false };
    this.startLocalVideo = this.startLocalVideo.bind(this);
    this.startHangup = this.startHangup.bind(this);
    this.localStream = null;
    this.remoteStream = null;
    this.peerConnection = null;
  }
  /**
   * @param {Object} props component is about to use
   * @returns {undefined}
   */
  componentWillReceiveProps(props) {
    if (
      (props.status === CallStatuses.Available
        || props.status === CallStatuses.Calling)
      && this.props.status === CallStatuses.Testing
    ) {
      this.endVideo();
    }
  }
  /**
   * @param {Object} props before update
   * @returns {undefined}
   */
  async componentDidUpdate(props) {
    // start video test
    if (
      props.status === CallStatuses.Available
      && this.props.status === CallStatuses.Testing
    ) {
      this.startVideoTest();
    }

    // start local video after accepting incoming call
    // -- or --
    // start local video and start peer connection after
    // outgoing call is accepted
    if (
      [CallStatuses.ReceivingCall, CallStatuses.Calling].includes(props.status)
      && this.props.status === CallStatuses.AcceptingCall
    ) {
      try {
        await this.startLocalVideo();
      } catch (err) {
        console.error(err);
        (this.props.status === CallStatuses.Calling ?
          this.startHangup.bind(this) : this.props.ignoreCall)();
      }
      if (props.status === CallStatuses.ReceivingCall) this.props.acceptCall();
      this.state.isInitiator = props.status === CallStatuses.Calling;
      this.startPeerConnection();
    }

    // New remote description
    if (props.remoteDescription !== this.props.remoteDescription) {
      this.peerConnection.setRemoteDescription(this.props.remoteDescription);
      if (!this.state.isInitiator) this.sendAnswer();
    }

    // New ICE candidate
    if (props.iceCandidate !== this.props.iceCandidate) {
      this.addIceCandidate();
    }

    // Handle receiving hangup
    if (
      props.status === CallStatuses.InCall
      && this.props.status === CallStatuses.HangingUp
    ) {
      this.onHangup();
    }

    // Handle video toggle
    if (props.videoEnabled !== this.props.videoEnabled) this.toggleVideoTrack();
    // Handle audio toggle
    if (props.audioEnabled !== this.props.audioEnabled) this.toggleAudioTrack();
  }
  /**
   * @returns {undefined}
   */
  componentWillUnmount() {
    if (this.hangupTimer) {
      clearTimeout(this.hangupTimer);
      this.hangupTimer = null;
    }
  }
  /**
   * @returns {undefined}
   */
  onHangup() {
    this.hangupTimer = setTimeout(() => {
      this.state.isInitiator = false;
      this.endVideo();
      this.props.setCallStatusToAvailable();
      clearTimeout(this.hangupTimer);
      this.hangupTimer = null;
    }, 5e3);
  }
  /**
   * @returns {undefined}
   */
  onRemoteStreamAdded({ stream }) {
    console.log('Remote stream added.');
    this.remoteVideo.srcObject = stream;
    this.remoteStream = stream;
  }
  /**
   * @returns {undefined}
   */
  onRemoteStreamRemoved() {
    console.log('Remote stream removed.');
    this.remoteVideo.srcObject = null;
    VideoChat.stopStream(this.remoteStream);
  }
  /**
   * @param {Object} description for session with peer
   * @returns {undefined}
   */
  setLocalDescriptionAndSendToPeer(description) {
    description.sdp = preferOpus(description.sdp);
    this.peerConnection.setLocalDescription(description);
    this.props.sendSessionDescription(description);
  }
  /**
   * @returns {undefined}
   */
  addIceCandidate() {
    if (!this.peerConnection) {
      this.startHangup();
      return;
    }
    const candidate = new RTCIceCandidate(this.props.iceCandidate);
    this.peerConnection.addIceCandidate(candidate);
    this.props.setCallStatusToInCall();
  }
  /**
   * @returns {undefined}
   */
  endVideo() {
    this.remoteVideo.srcObject = null;
    this.localVideo.srcObject = null;
    if (this.localStream) {
      VideoChat.stopStream(this.localStream);
      this.localStream = null;
    }
    if (this.remoteStream) {
      VideoChat.stopStream(this.remoteStream);
      this.remoteStream = null;
    }
  }
  /**
   * @returns {undefined}
   */
  async startHangup() {
    this.state.isInitiator = false;
    await this.props.emitHangup();
    this.endVideo();
    this.props.setCallStatusToAvailable();
  }
  /**
   * @returns {undefined}
   */
  sendAnswer() {
    if (!this.peerConnection) {
      this.startHangup();
      return;
    }
    this.peerConnection.createAnswer(
      this.setLocalDescriptionAndSendToPeer.bind(this),
      e => (
        console.log('createAnswer() error', e)
        || this.props.addError('Something went wrong setting up the peer connection')
      ),
      SDP_CONSTRAINTS,
    );
  }
  /**
   * @returns {undefined}
   */
  async startLocalVideo() {
    if (this.localVideo && this.localVideo.srcObject) return;
    this.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    this.localVideo.srcObject = this.localStream;
  }
  /**
   * @param {boolean} isInitiator if the user started the call
   * @returns {undefined}
   */
  startPeerConnection() {
    try {
      this.peerConnection = new RTCPeerConnection(this.props.iceServerConfig);
      this.peerConnection.onicecandidate = this.props.handleIceCandidate;
      this.peerConnection.onaddstream = this.onRemoteStreamAdded.bind(this);
      this.peerConnection.onremovestream = this.onRemoteStreamRemoved.bind(this);
      this.peerConnection.addStream(this.localStream);
      if (!this.state.isInitiator) return;
      this.peerConnection.createOffer(
        this.setLocalDescriptionAndSendToPeer.bind(this),
        e => (
          console.log('createOffer() error', e)
          || this.props.addError('Something went wrong setting up the peer connection')
        )
      );
    } catch (err) {
      console.error(err);
      this.props.addError('Failed to create a connection.');
      this.startHangup();
    }
  }
  /**
   * @returns {undefined}
   */
  async startVideoTest() {
    try {
      await this.startLocalVideo();
    } catch (err) {
      this.props.addError(/allowed/i.test(err.name) ?
        'Please allow camera access to use this app.'
        : 'Something went wrong starting the video'
      );
      return;
    }
    this.remoteVideo.srcObject = this.localStream;
  }
  /**
   * @returns {undefined}
   */
  toggleAudioTrack() {
    return this.localStream.getAudioTracks().forEach(
      track => track.enabled = !track.enabled
    );
  }
  /**
   * @returns {undefined}
   */
  toggleVideoTrack() {
    return this.localStream.getVideoTracks().forEach(
      track => track.enabled = !track.enabled
    );
  }
  /**
   * render
   * @returns {JSX.Element} HTML
   */
  render() {
    if (this.props.status === CallStatuses.Available) {
      return <Available />;
    }
    if ([CallStatuses.Calling, CallStatuses.CallFailed].includes(this.props.status)) {
      return <Calling />;
    }
    if (this.props.status === CallStatuses.ReceivingCall) {
      return <ReceivingCall />;
    }
    return (
      <div className="video-chat-container">
        <div className="remote-video-container">
          {[
            CallStatuses.AcceptingCall,
            CallStatuses.HangingUp,
          ].includes(this.props.status) && (
            <CallOverlay />
          )}
          <video
            ref={node => this.remoteVideo = node}
            className={classNames(
              'remote-video',
              [
                CallStatuses.AcceptingCall,
                CallStatuses.HangingUp,
              ].includes(this.props.status) && 'partially-transparent',
            )}
            autoPlay
          >
            <track kind="captions" />
          </video>
          <video
            ref={node => this.localVideo = node}
            className="local-video"
            autoPlay
          >
            <track kind="captions" />
          </video>
        </div>
        <Controller startHangup={this.startHangup} />
      </div>
    );
  }
}

VideoChat.propTypes = {
  status: PropTypes.shape(),
  addError: PropTypes.func,
  acceptCall: PropTypes.func,
  ignoreCall: PropTypes.func,
  handleIceCandidate: PropTypes.func,
  sendSessionDescription: PropTypes.func,
  iceServerConfig: PropTypes.oneOfType([
    PropTypes.shape(),
    PropTypes.arrayOf(PropTypes.shape()),
  ]),
  remoteDescription: PropTypes.shape(),
  iceCandidate: PropTypes.shape(),
  setCallStatusToInCall: PropTypes.func,
  setCallStatusToAvailable: PropTypes.func,
  emitHangup: PropTypes.func,
  videoEnabled: PropTypes.bool,
  audioEnabled: PropTypes.bool,
};

const mapStateToProps = state => ({
  status: state.call.status,
  iceServerConfig: state.call.iceServerConfig,
  remoteDescription: state.call.remoteDescription,
  iceCandidate: state.call.iceCandidate,
  videoEnabled: state.call.videoEnabled,
  audioEnabled: state.call.audioEnabled,
});
const mapDispatchToProps = {
  addError,
  acceptCall,
  ignoreCall,
  handleIceCandidate,
  sendSessionDescription,
  setCallStatusToInCall,
  setCallStatusToAvailable,
  emitHangup,
};

export default connect(mapStateToProps, mapDispatchToProps)(VideoChat);