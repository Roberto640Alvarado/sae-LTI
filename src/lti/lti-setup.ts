const lti = require('ltijs').Provider;
import * as mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import { LtiValidationService } from './lti-validation.service';
import { JwtService } from '../jwt/jwt.service';
import express from 'express';

dotenv.config();

const jwtService = new JwtService();

export const setupLti = async () => {
  const ltiValidation = new LtiValidationService();

  await lti.setup(
    process.env.LTI_KEY,
    { url: process.env.MONGO_URI },
    {
      appRoute: '/',
      loginRoute: '/login',
      cookies: { secure: true, sameSite: 'None' },
      devMode: false,
    },
  );

  await mongoose.connect(process.env.MONGO_URI!);
  console.log('Conectado a MongoDB');

  lti.onConnect(async (token, req, res) => {
    const ltiService = new LtiValidationService();
    //console.log('Token:', token);
    const name = token.userInfo?.name || 'Sin nombre';
    const email = token.userInfo?.email || 'Sin email';
    const roles = token.platformContext?.roles || [];

    const courseId = token.platformContext?.context?.id || 'unknown';
    const assignmentId = token.platformContext?.resource?.id || 'unknown';
    const issuer = token.iss;

    const isInstructor = roles.some((r) => r.includes('#Instructor'));
    const isAdmin = roles.some((r) => r.includes('#Administrator'));
    const isStudent = roles.some((r) => r.includes('#Learner'));
    const isMoodle = true;

    //VALIDACIONES

    if (isInstructor || isAdmin) {
      //Validar si la tarea ya fue enlazada a una tarea de github
      const hasTaskLink = await ltiService.hasTaskLink(assignmentId, issuer);
      if (hasTaskLink) {
        console.log('Esta tarea ya fue enlazada a una tarea de github');

        const taskLink = await ltiService.getTaskLinkByMoodleTask(
          assignmentId,
          issuer,
        ); //info de la tarea enlazada

        const idclassroom = taskLink?.idClassroom; //Id classroom
        const idtaskgithub = taskLink?.idTaskGithubClassroom; //Id tarea github
        const orgId = taskLink?.orgId; //Id de la organizacion
        const orgName = taskLink?.orgName; //Nombre de la organizacion
        const idtaskmoodle = taskLink?.idTaskMoodle; //Id tarea moodle
        const issuerM = taskLink?.issuer; //Issuer de moodle

        const payload = {
          idclassroom,
          idtaskgithub,
          orgId,
          orgName,
          idtaskmoodle,
          issuerM,
          token,
          isMoodle,
        };

        const tokenM  = jwtService.generateToken(payload, '1h');

        const query = new URLSearchParams({ token: tokenM }).toString();

        console.log('OrgName:', orgName);
        console.log('OrgId:', orgId);

        return res.redirect(
          `https://sae2025.netlify.app/repositorios?${query}`,
        );
      } else {
        console.log('Esta tarea no ha sido enlazada a una tarea de github');
        const payload = { email, isMoodle, courseId, assignmentId, issuer };
        const token = jwtService.generateToken(payload, '1h');
        const query = new URLSearchParams({ token }).toString();
        return res.redirect(`https://sae2025.netlify.app?${query}`);
      }
    } else if (isStudent) {
      //No Existe usuario en SAE
      const hasUser = await ltiService.hasUser(email);
      if (!hasUser) {
        console.log('Este usuario no existe en SAE');
        const isStudentMoodle = true;
        const payload = { isMoodle, isStudentMoodle };
        const token = jwtService.generateToken(payload, '1h');
        const query = new URLSearchParams({ token }).toString();
        return res.redirect(`https://sae2025.netlify.app?${query}`);
      } else {
        console.log('Este usuario ya existe en SAE');

        //Verificamos si la tarea ya fue enlazada a una tarea de github
        const hasTaskLink = await ltiService.hasTaskLink(assignmentId, issuer);
        if (!hasTaskLink) {
          console.log('Esta tarea no ha sido enlazada a una tarea de github');

          return res.redirect('https://sae2025.netlify.app/NoDisponible'); //Redirigir a una pagina de error,
        } else {
          console.log('Esta tarea ya fue enlazada a una tarea de github');
          const hasFeedback = await ltiService.hasFeedback(
            email,
            assignmentId,
            issuer,
          );
          if (hasFeedback) {
            console.log('Este usuario ya tiene feedback en esta tarea');

            const idTaskClassroom = await ltiService.getTaskLinkByMoodleTask(
              assignmentId,
              issuer,
            ); //Id de la tarea de classroom
            const payload = { email, isMoodle, idTaskClassroom, name };
            const token = jwtService.generateToken(payload, '1h');
            const query = new URLSearchParams({ token }).toString();
            return res.redirect(
              `https://sae2025.netlify.app/feedback?${query}`,
            );
          } else {
            console.log('Este usuario no tiene feedback en esta tarea');
            const urlInvitation = await ltiService.getInvitationUrlByMoodleTask(
              assignmentId,
              issuer,
            );
            const payload = { isMoodle, urlInvitation, name };
            const token = jwtService.generateToken(payload, '1h');
            const query = new URLSearchParams({ token }).toString();
            return res.redirect(
              `https://sae2025.netlify.app/invitacion?${query}`,
            );
          }
        }
      }
    }
  });


  const port = parseInt(process.env.PORT || '3005', 10);
  await lti.deploy({ port });
  console.log(`✓ LTI escuchando en el puerto ${port}`);

  const app = lti.app;
  app.post('/send-grades', async (req, res) => {
    const { assignmentId, issuer, token } = req.body;
  
    if (!token) return res.status(401).json({ message: 'Token no válido' });
  
    try {
      const ltiService = new LtiValidationService();
      const taskLink = await ltiService.getTaskLinkByMoodleTask(assignmentId, issuer);
      const membersUrl = token.platformContext.namesRoles?.context_memberships_url;
      const members = await lti.NamesAndRoles.getMembers(token, membersUrl);
  
      const estudiantes = members.members.filter((user: any) =>
        user.roles.some((role: string) =>
          role.endsWith('#Learner') || role === 'Learner'
        )
      );
  
      const resultadoNotas: any[] = [];
      for (const estudiante of estudiantes) {
        let gradeAction = 0;
        let gradeFeedback = 0;
  
        try {

          const idTareaLTI = taskLink?.idTaskGithubClassroom;
        if (!idTareaLTI) {
          throw new Error(
            'idTaskGithubClassroom no está definido en taskLink',
          );
        }
        
          const feedback = await ltiService.getFeedbackByEmailAndIdTaskGithub(
            estudiante.email,
            taskLink.idTaskGithubClassroom,
          );
          if (feedback) {
            gradeAction = feedback.gradeValue;
            gradeFeedback = feedback.gradeFeedback;
          }
        } catch {}
  
        resultadoNotas.push({
          userId: estudiante.user_id,
          grade: (gradeAction + gradeFeedback) / 2,
        });
      }
  
      let lineItemId = token.platformContext.endpoint.lineitem;
      if (!lineItemId) {
        const response = await lti.Grade.getLineItems(token, { resourceLinkId: true });
        const lineItems = response?.lineItems || [];
  
        if (lineItems.length === 0) {
          const newLineItem = {
            scoreMaximum: 10,
            label: 'Nota automática',
            tag: 'autograde',
            resourceLinkId: token.platformContext.resource.id
          };
          const created = await lti.Grade.createLineItem(token, newLineItem);
          lineItemId = created.id;
        } else {
          lineItemId = lineItems[0].id;
        }
      }
  
      for (const nota of resultadoNotas) {
        const score = {
          userId: nota.userId,
          scoreGiven: nota.grade,
          scoreMaximum: 10,
          activityProgress: 'Completed',
          gradingProgress: 'FullyGraded',
        };
  
        await lti.Grade.submitScore(token, lineItemId, score);
      }
  
      return res.status(200).json({ message: 'Notas enviadas correctamente' });
    } catch (err) {
      console.error('Error al enviar notas desde SAE:', err);
      return res.status(500).json({ message: 'Error interno' });
    }
  });

  //Registra la plataforma LTI
  await lti.registerPlatform({
    url: 'https://ecampusuca.moodlecloud.com',
    name: 'EcampusUCA',
    clientId: 'd8Af3rpbiUdOneX',
    authenticationEndpoint:
      'https://ecampusuca.moodlecloud.com/mod/lti/auth.php',
    accesstokenEndpoint: 'https://ecampusuca.moodlecloud.com/mod/lti/token.php',
    authConfig: {
      method: 'JWK_SET',
      key: 'https://ecampusuca.moodlecloud.com/mod/lti/certs.php',
    },
  });

  console.log('Plataforma LTI registrada');
};
