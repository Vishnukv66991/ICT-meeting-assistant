"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getCurrentUser,
  getErrorMessage,
  getMeeting,
  getMeetingCallSocketUrl,
  getMeetingCallStatus,
  type Meeting,
  type MeetingCallStatus,
  type MeetingParticipant,
  type User,
} from "@/lib/api";

type PeerConnectionEntry = {
  connection: RTCPeerConnection;
  pendingCandidates: RTCIceCandidateInit[];
};

type CallParticipant = {
  user_id: number;
  name: string;
  role: MeetingParticipant["role"];
};

type CallMessage = {
  type: string;
  message?: string;
  participant?: CallParticipant;
  user_id?: number;
  from_user_id?: number;
  host_user_id?: number | null;
  participants?: CallParticipant[];
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

export default function MeetingCallPage() {
  const params = useParams<{ meetingId: string }>();
  const meetingId = Number(params.meetingId);
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [callStatus, setCallStatus] = useState<MeetingCallStatus | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<number, { participant: MeetingParticipant; stream: MediaStream }>>({});
  const [joined, setJoined] = useState(false);
  const [active, setActive] = useState(false);
  const [callEnded, setCallEnded] = useState(false);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [error, setError] = useState("");
  const socketRef = useRef<WebSocket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionsRef = useRef(new Map<number, PeerConnectionEntry>());
  const currentUserIdRef = useRef<number | null>(null);
  const activeRef = useRef(false);
  const intentionalCloseRef = useRef(false);

  useEffect(() => {
    if (!Number.isInteger(meetingId) || meetingId < 1) {
      setError("Meeting not found.");
      return;
    }
    Promise.all([getCurrentUser(), getMeeting(meetingId), getMeetingCallStatus(meetingId)])
      .then(([currentUser, currentMeeting, status]) => {
        setUser(currentUser);
        currentUserIdRef.current = currentUser.id;
        setMeeting(currentMeeting);
        setCallStatus(status);
        activeRef.current = status.active;
        setActive(status.active);
      })
      .catch((caught: unknown) => setError(getErrorMessage(caught)));
  }, [meetingId]);

  const closeCallResources = useCallback(() => {
    intentionalCloseRef.current = true;
    socketRef.current?.close();
    socketRef.current = null;
    peerConnectionsRef.current.forEach(({ connection }) => connection.close());
    peerConnectionsRef.current.clear();
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    setLocalStream(null);
    setRemoteStreams({});
    setJoined(false);
    activeRef.current = false;
    setActive(false);
  }, []);

  useEffect(() => () => closeCallResources(), [closeCallResources]);

  const sendSignal = useCallback((message: Record<string, unknown>) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }, []);

  const flushCandidates = useCallback(async (entry: PeerConnectionEntry) => {
    const candidates = entry.pendingCandidates.splice(0);
    for (const candidate of candidates) {
      await entry.connection.addIceCandidate(candidate);
    }
  }, []);

  const getPeerConnection = useCallback((participant: MeetingParticipant) => {
    const existing = peerConnectionsRef.current.get(participant.id);
    if (existing) return existing;

    const connection = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    const entry: PeerConnectionEntry = { connection, pendingCandidates: [] };
    peerConnectionsRef.current.set(participant.id, entry);
    const localStream = localStreamRef.current;
    localStream?.getTracks().forEach((track) => connection.addTrack(track, localStream));
    connection.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal({
          type: "ice_candidate",
          target_user_id: participant.id,
          candidate: event.candidate.toJSON(),
        });
      }
    };
    connection.ontrack = (event) => {
      const stream = event.streams[0];
      if (stream) setRemoteStreams((current) => ({ ...current, [participant.id]: { participant, stream } }));
    };
    connection.onconnectionstatechange = () => {
      if (connection.connectionState === "failed") {
        setError(`Could not connect to ${participant.full_name}. Check your network and try again.`);
      }
    };
    return entry;
  }, [sendSignal]);

  const handleCallMessage = useCallback(async (message: CallMessage) => {
    if (message.type === "waiting") return;
    if (message.type === "call_started") {
      activeRef.current = true;
      setActive(true);
      setCallStatus((current) => current ? { ...current, active: true, host_user_id: message.host_user_id ?? current.host_user_id } : current);
      sendSignal({ type: "join_call" });
      return;
    }
    if (message.type === "participant_ready" && message.participant) {
      const participant = meeting?.participants.find((member) => member.id === message.participant?.user_id);
      if (!participant || participant.id === currentUserIdRef.current) return;
      if (currentUserIdRef.current !== null && currentUserIdRef.current < participant.id) {
        const entry = getPeerConnection(participant);
        const offer = await entry.connection.createOffer();
        await entry.connection.setLocalDescription(offer);
        sendSignal({ type: "offer", target_user_id: participant.id, description: offer });
      }
      return;
    }
    if (message.type === "offer" && message.from_user_id && message.description) {
      const participant = meeting?.participants.find((member) => member.id === message.from_user_id);
      if (!participant) return;
      const entry = getPeerConnection(participant);
      await entry.connection.setRemoteDescription(message.description);
      await flushCandidates(entry);
      const answer = await entry.connection.createAnswer();
      await entry.connection.setLocalDescription(answer);
      sendSignal({ type: "answer", target_user_id: participant.id, description: answer });
      return;
    }
    if (message.type === "answer" && message.from_user_id && message.description) {
      const entry = peerConnectionsRef.current.get(message.from_user_id);
      if (entry) {
        await entry.connection.setRemoteDescription(message.description);
        await flushCandidates(entry);
      }
      return;
    }
    if (message.type === "ice_candidate" && message.from_user_id && message.candidate) {
      const participant = meeting?.participants.find((member) => member.id === message.from_user_id);
      if (!participant) return;
      const entry = getPeerConnection(participant);
      if (entry.connection.remoteDescription) {
        await entry.connection.addIceCandidate(message.candidate);
      } else {
        entry.pendingCandidates.push(message.candidate);
      }
      return;
    }
    if (message.type === "participant_left" && message.user_id) {
      peerConnectionsRef.current.get(message.user_id)?.connection.close();
      peerConnectionsRef.current.delete(message.user_id);
      setRemoteStreams((current) => {
        const next = { ...current };
        delete next[message.user_id!];
        return next;
      });
      return;
    }
    if (message.type === "call_ended") {
      closeCallResources();
      setCallEnded(true);
      return;
    }
    if (message.type === "error" && message.message) setError(message.message);
  }, [closeCallResources, flushCandidates, getPeerConnection, meeting, sendSignal]);

  async function enterCall(startCall: boolean) {
    if (joined || !meeting || !user) return;
    setError("");
    setCallEnded(false);
    intentionalCloseRef.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      localStreamRef.current = stream;
      setLocalStream(stream);
      const socket = new WebSocket(getMeetingCallSocketUrl(meetingId));
      socketRef.current = socket;
      socket.onopen = () => {
        setJoined(true);
        if (startCall) sendSignal({ type: "start" });
      };
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data)) as CallMessage;
          void handleCallMessage(message).catch((caught: unknown) => setError(getErrorMessage(caught)));
        } catch {
          setError("Received an invalid message from the call server.");
        }
      };
      socket.onerror = () => setError("Could not connect to the call server. Please try again.");
      socket.onclose = () => {
        if (!intentionalCloseRef.current) {
          setError("The call connection was closed.");
          closeCallResources();
        }
      };
    } catch (caught) {
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
      setLocalStream(null);
      setError(caught instanceof Error && caught.name === "NotAllowedError"
        ? "Allow camera and microphone access in your browser to join the call."
        : getErrorMessage(caught));
    }
  }

  function leaveCall() {
    sendSignal({ type: "leave" });
    closeCallResources();
  }

  function endCall() {
    sendSignal({ type: "end" });
  }

  function toggleMicrophone() {
    const nextMuted = !muted;
    localStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = !nextMuted; });
    setMuted(nextMuted);
  }

  function toggleCamera() {
    const nextCameraOff = !cameraOff;
    localStreamRef.current?.getVideoTracks().forEach((track) => { track.enabled = !nextCameraOff; });
    setCameraOff(nextCameraOff);
  }

  if (error && !meeting) return <section className="meeting-call-page"><p className="form-error" role="alert">{error}</p><Link className="back-link" href="/meetings">← Back to meetings</Link></section>;
  if (!meeting || !user) return <div className="profile-loading" role="status">Loading meeting…</div>;

  const isOrganiser = meeting.participants.some((participant) => participant.id === user.id && participant.role === "Meeting organiser");
  const remoteTiles = Object.values(remoteStreams);
  const actionLabel = callStatus?.active ? "Join active call" : isOrganiser ? "Start group call" : "Join waiting room";

  return (
    <section className="meeting-call-page">
      <Link className="back-link" href={`/meetings/${meeting.id}`}>← {meeting.title}</Link>
      <div className="eyebrow">MEETING SPACE · GROUP VIDEO</div>
      <div className="meeting-call-heading"><div><h1>{meeting.title}</h1><p>{active ? "Call in progress" : callEnded ? "Call ended" : "Ready when you are"}</p></div>
        <span className={`call-status${active ? " call-status-active" : ""}`}><span />{active ? "LIVE" : callEnded ? "ENDED" : "NOT STARTED"}</span>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}

      {callEnded ? (
        <div className="meeting-call-ended"><strong>This call has ended.</strong><Link className="button button-quiet" href={`/meetings/${meeting.id}`}>Back to meeting space</Link></div>
      ) : !joined ? (
        <div className="call-lobby">
          <strong>{callStatus?.active ? "The group is already on the call." : isOrganiser ? "Start a video call for this meeting space." : "You can join the room while you wait for the organiser."}</strong>
          <span>{meeting.participants.length} invited {meeting.participants.length === 1 ? "person" : "people"}. Your camera and microphone will be requested when you join.</span>
          <button className="button button-primary" type="button" onClick={() => void enterCall(isOrganiser && !callStatus?.active)}>{actionLabel} <span aria-hidden="true">↗</span></button>
        </div>
      ) : (
        <>
          {!active && <p className="call-waiting" role="status">You’re in the waiting room. The organiser will start the call shortly.</p>}
          <div className="call-video-grid">
            {localStream && <div className="call-video-tile call-video-local"><video autoPlay muted playsInline ref={(element) => { if (element && element.srcObject !== localStream) element.srcObject = localStream; }} /><span className="call-video-name">{user.full_name} (you)</span></div>}
            {remoteTiles.map(({ participant, stream }) => <div className="call-video-tile" key={participant.id}>
              <video autoPlay playsInline ref={(element) => { if (element && element.srcObject !== stream) element.srcObject = stream; }} />
              <span className="call-video-name">{participant.full_name}</span>
            </div>)}
          </div>
          <div className="call-controls">
            <button className="button button-quiet" type="button" onClick={toggleMicrophone}>{muted ? "Turn microphone on" : "Mute microphone"}</button>
            <button className="button button-quiet" type="button" onClick={toggleCamera}>{cameraOff ? "Turn camera on" : "Turn camera off"}</button>
            {isOrganiser && active && <button className="button call-end-button" type="button" onClick={endCall}>End call</button>}
            <button className="button button-quiet" type="button" onClick={leaveCall}>Leave call</button>
          </div>
        </>
      )}
      {!callEnded && <section className="call-roster"><h2>Invited people <span>{meeting.participants.length}</span></h2><ul>{meeting.participants.map((participant) => (
        <li key={participant.id}><span className="table-avatar">{participant.full_name.slice(0, 1).toUpperCase()}</span><span>{participant.full_name}{participant.id === user.id ? " (you)" : ""}</span><small>{participant.role}</small></li>
      ))}</ul></section>}
    </section>
  );
}
